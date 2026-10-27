routerAdd('POST', '/backend/v1/whatsapp/webhook', (e) => {
  // Normaliza messageTimestamp do Evolution/Baileys (que pode chegar como
  // number, string, Long protobuf {low, high, unsigned} ou null/undefined)
  // para Unix segundos. Retorna 0 quando não dá pra interpretar.
  // Sem isso, payloads com Long viram objeto truthy → coagido a 0/NaN
  // pelo NumberField do PocketBase, e a ordenação da chat list quebra.
  function tsToUnixSeconds(ts) {
    if (ts == null) return 0
    if (typeof ts === 'number') {
      if (!isFinite(ts) || ts <= 0) return 0
      return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
    }
    if (typeof ts === 'string') {
      const n = parseInt(ts, 10)
      if (!isFinite(n) || n <= 0) return 0
      return n > 1e12 ? Math.floor(n / 1000) : n
    }
    if (typeof ts === 'object') {
      if (typeof ts.low === 'number' && typeof ts.high === 'number') {
        const n = ts.high * 4294967296 + (ts.low >>> 0)
        if (!isFinite(n) || n <= 0) return 0
        return n > 1e12 ? Math.floor(n / 1000) : n
      }
      if (typeof ts.toNumber === 'function') {
        try {
          const n = ts.toNumber()
          if (typeof n === 'number' && isFinite(n) && n > 0) {
            return n > 1e12 ? Math.floor(n / 1000) : n
          }
        } catch (_) {}
      }
    }
    return 0
  }

  // Always return 200 OK immediately to Evolution API, to avoid unneeded retries
  try {
    const body = e.requestInfo().body || {}
    const event = body.event
    const instanceName = body.instance
    const data = body.data

    if (!instanceName || !event) {
      return e.json(200, { received: true, ignored: true, reason: 'missing_data' })
    }

    let instanceRecord
    try {
      instanceRecord = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'instance_name = {:name}',
        { name: instanceName },
      )
    } catch (_) {
      $app.logger().warn('Webhook received for unknown instance', 'instanceName', instanceName)
      return e.json(200, { received: true, ignored: true, reason: 'unknown_instance' })
    }

    const userId = instanceRecord.getString('user_id')
    let accountId = instanceRecord.getString('account_id')
    if (!accountId) {
      try {
        const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
          userId,
        })
        accountId = member.getString('account_id')
      } catch (_) {}
    }

    const convCache = new Map()
    const getConvAiStatus = (jid, instName) => {
      const key = `${instName}_${jid}`
      if (convCache.has(key)) return convCache.get(key)
      try {
        const c = $app.findFirstRecordByFilter(
          'conversations',
          'remote_jid = {:jid} && instance_name = {:name}',
          { jid, name: instName },
        )
        const res = { enabled: c.getBool('ai_enabled'), agentId: c.getString('ai_agent_id') }
        convCache.set(key, res)
        return res
      } catch (_) {
        const res = { enabled: false, agentId: null }
        convCache.set(key, res)
        return res
      }
    }

    // Acumulador de updates de conversation agrupados por remote_jid.
    // Por que: antes, cada mensagem dentro de um batch (messages.set pode
    // trazer até 500) fazia $app.save(convRecord) → cada save dispara
    // realtime SSE → front faz setState + sort. Para 500 msgs em ~50
    // convs distintas, eram 500 saves e 500 eventos. Agora: 1 save por
    // conv distinta no batch (50 saves, 50 eventos). Reduz IO no SQLite
    // e load no front em ordem de magnitude.
    const convUpdates = new Map()

    const recordConvUpdate = (info) => {
      if (!info || !info.remoteJid) return
      let agg = convUpdates.get(info.remoteJid)
      if (!agg) {
        agg = { isGroup: info.isGroup, msgs: [] }
        convUpdates.set(info.remoteJid, agg)
      }
      agg.msgs.push({
        ts: info.ts,
        fromMe: info.fromMe,
        fallbackText: info.fallbackText,
        pushName: info.pushName,
      })
    }

    // Aplica os updates acumulados em 1 save por conv distinta.
    // Preserva o comportamento original do "isNewer" sequencial: ordenamos
    // as msgs por ts asc e simulamos o if/else original em memória, então
    // o estado final (last_message, last_message_timestamp, unread_count)
    // bate exatamente com o que sairia se cada msg salvasse uma a uma.
    const flushConvUpdates = () => {
      for (const [remoteJid, agg] of convUpdates) {
        try {
          let convRecord
          let isNewConv = false
          try {
            convRecord = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid = {:jid} && instance_name = {:name}',
              { jid: remoteJid, name: instanceName },
            )
          } catch (_) {
            const convCol = $app.findCollectionByNameOrId('conversations')
            convRecord = new Record(convCol)
            convRecord.set('user_id', userId)
            if (accountId) convRecord.set('account_id', accountId)
            convRecord.set('instance_name', instanceName)
            convRecord.set('remote_jid', remoteJid)
            convRecord.set('is_group', agg.isGroup)
            convRecord.set('type', agg.isGroup ? 'group' : 'individual')
            convRecord.set('unread_count', 0)
            isNewConv = true
          }

          const sortedMsgs = agg.msgs.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))
          let changed = isNewConv

          for (const m of sortedMsgs) {
            const lastTs = convRecord.getInt('last_message_timestamp') || 0
            const isNewer = m.ts > 0 && m.ts >= lastTs
            if (isNewer) {
              convRecord.set('last_message', m.fallbackText)
              convRecord.set('last_message_timestamp', m.ts)
              if (m.fromMe) {
                convRecord.set('unread_count', 0)
              } else {
                const currentUnread = convRecord.getInt('unread_count') || 0
                convRecord.set('unread_count', currentUnread + 1)
              }
              changed = true
            }
            // contact_name: nunca sobrescrever contact_name já preenchido (se preenchido e válido, preservar)
            if (!agg.isGroup && m.pushName && !m.fromMe && !isInvalidOrClinicPushName(m.pushName)) {
              const currentName = (convRecord.getString('contact_name') || '').trim()
              if (!currentName || isInvalidOrClinicPushName(currentName)) {
                convRecord.set('contact_name', m.pushName)
                changed = true
                propagatePatientName(remoteJid, instanceName, m.pushName)
              }
            }
          }

          if (changed) {
            $app.save(convRecord)
          }
        } catch (err) {
          $app.logger().warn('flush_conv_update_error', 'jid', remoteJid, 'error', String(err))
        }
      }
      convUpdates.clear()
    }

    // Helper para detectar nomes inválidos, genéricos, razão social ou pertencentes à própria clínica
    const isInvalidOrClinicPushName = (name) => {
      if (!name) return true
      const trimmed = String(name).trim()
      if (!trimmed) return true
      if (trimmed.indexOf('@') !== -1) return true
      if (/^[.\-_*#@!?,:;~^`'"]+$/.test(trimmed)) return true
      if (/^\d{10,}$/.test(trimmed)) return true
      if (!/[a-zA-Z\u00C0-\u017F]/.test(trimmed)) return true

      const lower = trimmed.toLowerCase()
      const blocked = [
        'você',
        'voce',
        'eu',
        'you',
        'me',
        'i',
        'contato whatsapp',
        'sem nome',
        'null',
        'undefined',
        'desconhecido',
      ]
      if (blocked.indexOf(lower) !== -1) return true

      // Rejeita termos corporativos / razão social (ex: "Engenharia", "Ltda", "MEI", etc.)
      if (
        /\b(engenharia|ltda|mei|eireli|s\/a|s\.a\.|advocacia|escrit[oó]rio|contabilidade|im[oó]veis|imobili[aá]ria|consultoria|servi[çc]os|com[eé]rcio|distribuidora|m[eé]dica|cl[ií]nica)\b/i.test(
          lower,
        )
      ) {
        return true
      }

      // Rejeita variações do nome da clínica / assistente
      if (
        (lower.indexOf('fabiana') !== -1 && lower.indexOf('assistente') !== -1) ||
        (lower.indexOf('assistente') !== -1 &&
          (lower.indexOf('dr.') !== -1 ||
            lower.indexOf('dr ') !== -1 ||
            lower.indexOf('caio') !== -1 ||
            lower.indexOf('nutri') !== -1)) ||
        (lower.indexOf('dr. caio') !== -1 && lower.indexOf('nutri') !== -1) ||
        lower === 'fabiana assistente dr. caio nutricionista' ||
        lower === 'fabiana assistente dr. caio cândido nutri'
      ) {
        return true
      }

      return false
    }

    // Propaga nome do paciente de forma consistente para conversations, crm_contacts e tasks
    const propagatePatientName = (remoteJid, instName, newName) => {
      if (!newName || isInvalidOrClinicPushName(newName) || !remoteJid) return
      try {
        const crmRec = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && (jid = {:jid} || phone ~ {:phone})',
          { inst: instName, jid: remoteJid, phone: remoteJid.split('@')[0] },
        )
        if (crmRec) {
          const cName = (crmRec.getString('contact_name') || '').trim()
          const pName = (crmRec.getString('push_name') || '').trim()
          let crmDirty = false
          // Nome oficial protegido: NUNCA sobrescrever contact_name já preenchido
          if (!cName || isInvalidOrClinicPushName(cName)) {
            crmRec.set('contact_name', newName)
            crmDirty = true
          }
          if (!pName) {
            crmRec.set('push_name', newName)
            crmDirty = true
          }
          if (crmDirty) {
            $app.save(crmRec)
          }

          // Atualiza títulos de tarefas pendentes do contato se estiverem genéricos ou sem nome
          try {
            const tasks = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
              '+created',
              20,
              0,
              { cid: crmRec.id },
            )
            for (let ti = 0; ti < tasks.length; ti++) {
              const task = tasks[ti]
              const oldTitle = task.getString('title') || ''
              if (
                isInvalidOrClinicPushName(oldTitle) ||
                oldTitle.indexOf('+') !== -1 ||
                oldTitle.indexOf('@') !== -1 ||
                oldTitle.startsWith('Atendimento:') ||
                oldTitle.startsWith('Falar com') ||
                oldTitle.startsWith('Atender')
              ) {
                let prefix = 'Atendimento: '
                if (oldTitle.indexOf(':') !== -1) {
                  prefix = oldTitle.split(':')[0] + ': '
                }
                task.set('title', prefix + newName)
                $app.saveNoValidate(task)
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Helper functions inside the handler
    const configureWebhook = (instName) => {
      const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
      const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
      const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
      let webhookUrl = $secrets.get('PB_WEBHOOK_URL') || ''

      if (!webhookUrl) {
        const instanceUrl = $secrets.get('PB_INSTANCE_URL') || ''
        if (instanceUrl) {
          webhookUrl =
            (instanceUrl.endsWith('/') ? instanceUrl.slice(0, -1) : instanceUrl) +
            '/backend/v1/whatsapp/webhook'
        }
      }

      if (!webhookUrl) {
        const proto = e.request.header.get('X-Forwarded-Proto') || 'https'
        webhookUrl = proto + '://' + e.request.host + '/backend/v1/whatsapp/webhook'
      }

      if (apiUrl && apiKey && webhookUrl) {
        try {
          $http.send({
            url: apiUrl + '/webhook/set/' + instName,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify({
              enabled: true,
              url: webhookUrl,
              byEvents: false,
              base64: true,
              events: [
                'APPLICATION_STARTUP',
                'QRCODE_UPDATED',
                'MESSAGES_SET',
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
                'MESSAGES_DELETE',
                'SEND_MESSAGE',
                'CONTACTS_SET',
                'CONTACTS_UPSERT',
                'CONTACTS_UPDATE',
                'PRESENCE_UPDATE',
                'CHATS_SET',
                'CHATS_UPSERT',
                'CHATS_UPDATE',
                'CHATS_DELETE',
                'GROUPS_UPSERT',
                'GROUP_UPDATE',
                'GROUP_PARTICIPANTS_UPDATE',
                'CONNECTION_UPDATE',
                'CALL',
              ],
            }),
            timeout: 10,
          })
        } catch (err) {
          $app
            .logger()
            .error(
              'Webhook auto-config failed',
              'error',
              err?.message || String(err),
              'instance',
              instName,
            )
        }
      }
    }

    // Carrega remetentes autorizados de care_alert_settings para identificar humano_celular
    let authorizedSendersList = []
    try {
      const sRec = accountId
        ? $app.findFirstRecordByFilter('care_alert_settings', 'account_id = {:aid}', {
            aid: accountId,
          })
        : $app.findFirstRecordByFilter('care_alert_settings', '')
      if (sRec) {
        const rawAuth = sRec.getString('authorized_senders') || ''
        if (rawAuth) {
          authorizedSendersList = rawAuth
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        }
      }
    } catch (_) {}

    const processMessage = (msg) => {
      if (!msg || !msg.key || !msg.message) return

      // Evolution API injeta um campo `base64` dentro de msg.message quando a
      // mídia já foi decodificada. Sem filtrar, o find() pega `base64` como
      // typeKey em vez de imageMessage/videoMessage, e a mensagem caía no else
      // final virando "[Mensagem não suportada]". Filtramos `base64` também.
      const typeKey = Object.keys(msg.message).find(
        (k) => k !== 'messageContextInfo' && k !== 'base64',
      )

      if (
        !typeKey ||
        ['protocolMessage', 'senderKeyDistributionMessage', 'secretEncryptedMessage'].includes(
          typeKey,
        )
      ) {
        $app.logger().info('protocol_message_skipped', 'type', typeKey)
        return
      }

      const remoteJid = msg.key.remoteJid
      if (!remoteJid || remoteJid === 'status@broadcast') return

      const isGroup = remoteJid.endsWith('@g.us')
      const messageId = msg.key.id
      const fromMe = msg.key.fromMe === true
      const instPhone = (instanceRecord.getString('phone_number') || '').replace(/\D/g, '')
      const senderPhone = (msg.key.participant || remoteJid).split('@')[0].replace(/\D/g, '')
      const isOwnSender = fromMe || (instPhone && senderPhone === instPhone)

      const participantJid = msg.key.participant || ''
      const pushName = msg.pushName || ''
      // Mensagens da própria clínica (from_me ou número da própria instância) NUNCA fornecem contact_name pro paciente
      const validPatientPushName =
        isOwnSender || isInvalidOrClinicPushName(pushName) ? '' : pushName

      if (typeKey === 'reactionMessage') {
        const reaction = msg.message.reactionMessage
        const targetId = reaction.key.id
        const emoji = reaction.text || ''
        try {
          const targetMsg = $app.findFirstRecordByFilter(
            'whatsapp_messages',
            'message_id = {:msgId} && instance_name = {:name}',
            { msgId: targetId, name: instanceName },
          )

          let reactions = []
          try {
            const raw = targetMsg.get('reactions')
            if (raw) {
              if (typeof raw === 'string') reactions = JSON.parse(raw)
              else if (Array.isArray(raw)) reactions = raw
            }
          } catch (e) {}

          reactions = reactions.filter((r) => r.participant !== participantJid)
          if (emoji) {
            reactions.push({ emoji, participant: participantJid })
          }
          targetMsg.set('reactions', reactions)
          $app.save(targetMsg)
        } catch (_) {}
        return
      }

      let content = ''
      let msgType = ''

      if (typeKey === 'conversation') {
        content = msg.message.conversation
        msgType = 'conversation'
      } else if (typeKey === 'extendedTextMessage') {
        content = msg.message.extendedTextMessage?.text || ''
        msgType = 'extendedTextMessage'
        const etm = msg.message.extendedTextMessage
        if (etm.canonicalUrl || etm.matchedText) {
          msg.linkPreview = {
            url: etm.canonicalUrl || etm.matchedText || '',
            title: etm.title || '',
            description: etm.description || '',
            thumbnail: etm.jpegThumbnail || '',
          }
        }
      } else if (
        [
          'imageMessage',
          'videoMessage',
          'audioMessage',
          'documentMessage',
          'stickerMessage',
        ].includes(typeKey)
      ) {
        msgType = typeKey
        const mediaData = msg.message[typeKey]
        const caption = mediaData.caption || ''
        content = caption || ''

        let base64Str =
          msg.base64 ||
          mediaData.base64 ||
          data?.base64 ||
          msg.message?.base64 ||
          data?.message?.base64 ||
          ''

        if (!base64Str) {
          const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
          const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
          const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

          if (apiUrl && apiKey) {
            try {
              const res = $http.send({
                url: apiUrl + '/chat/getBase64FromMediaMessage/' + instanceName,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: apiKey },
                body: JSON.stringify({ message: msg, convertToMp4: false }),
                timeout: 30,
              })

              if (res.statusCode === 200 && res.json && res.json.base64) {
                base64Str = res.json.base64
              }
            } catch (err) {
              $app.logger().error('getBase64 error', 'err', String(err))
            }
          }
        }

        msg.extractedMedia = {
          base64: base64Str,
          mimetype: mediaData.mimetype || '',
          filename: mediaData.fileName || mediaData.title || '',
          caption: caption,
        }
      } else if (['pollCreationMessage', 'pollUpdateMessage'].includes(typeKey)) {
        msgType = 'pollMessage'
        content = '[Enquete]'
      } else if (typeKey === 'locationMessage') {
        msgType = 'locationMessage'
        content = '[Localização compartilhada]'
      } else if (
        typeKey === 'contactMessage' ||
        typeKey === 'contactsMessage' ||
        typeKey === 'contactsArrayMessage'
      ) {
        msgType = 'contactMessage'
        content =
          typeKey === 'contactsArrayMessage' || typeKey === 'contactsMessage'
            ? '[Contatos compartilhados]'
            : '[Contato compartilhado]'
      } else if (typeKey === 'reactionMessage') {
        msgType = 'reactionMessage'
        content = '[Reação]'
      } else if (typeKey === 'ephemeralMessage') {
        msgType = 'ephemeralMessage'
        content = '[Mensagem temporária]'
      } else if (typeKey === 'protocolMessage') {
        msgType = 'protocolMessage'
        content = '[Mensagem do sistema]'
      } else if (typeKey === 'templateMessage') {
        msgType = 'template'
        content = '[Mensagem de template]'
      } else if (typeKey === 'associatedChildMessage') {
        msgType = 'associated_child'
        content = '[Mensagem vinculada]'
      } else if (typeKey === 'albumMessage') {
        msgType = 'album'
        content = '[Álbum de mídia]'
      } else if (typeKey === 'pinInChatMessage') {
        msgType = 'pinInChat'
        content = '[Mensagem fixada]'
      } else {
        msgType = typeKey || 'unknown'
        content = '[Mensagem não suportada]'
      }

      // Extrai indicador de encaminhamento (contextInfo.isForwarded) e
      // forwardingScore, quando presentes. O front exibe um badge
      // "Encaminhado" quando is_forwarded = true.
      try {
        const ctxInfo =
          (msg.message[typeKey] && msg.message[typeKey].contextInfo) || msg.message.contextInfo
        if (ctxInfo && ctxInfo.isForwarded === true) {
          msg.isForwarded = true
          if (typeof ctxInfo.forwardingScore === 'number' && ctxInfo.forwardingScore > 0) {
            msg.forwardingScore = ctxInfo.forwardingScore
          }
        }
      } catch (_) {}

      try {
        $app.findFirstRecordByFilter(
          'whatsapp_messages',
          'message_id = {:msgId} && instance_name = {:name}',
          { msgId: messageId, name: instanceName },
        )
        return // Duplicate
      } catch (_) {}

      const normalizedTs = tsToUnixSeconds(msg.messageTimestamp)
      const currentTs = Math.floor(Date.now() / 1000)
      const msgAge = normalizedTs > 0 ? currentTs - normalizedTs : 999999

      let pendingAiResponse = false
      if (
        !fromMe &&
        !isGroup &&
        (msgType === 'conversation' || msgType === 'extendedTextMessage')
      ) {
        if (msgAge >= 0 && msgAge < 60) {
          const aiStatus = getConvAiStatus(remoteJid, instanceName)
          if (aiStatus.enabled && aiStatus.agentId) {
            pendingAiResponse = true
          }
        }
      }

      // Determinar origin da mensagem
      // humano_celular | humano_crm | ia | automacao | desconhecido
      let detectedOrigin = 'desconhecido'
      if (fromMe) {
        const isAiMarked =
          pendingAiResponse ||
          pushName.indexOf('Assistente') !== -1 ||
          pushName.indexOf('IA') !== -1 ||
          content.indexOf('[IA]') !== -1
        if (isAiMarked) {
          detectedOrigin = 'ia'
        } else {
          // Checa se o remetente participante ou da mensagem bate com authorizedSendersList
          const pJidNorm = (participantJid || '').toLowerCase()
          const pDigits = pJidNorm.split('@')[0].replace(/\D/g, '')
          const isSenderAuthorized = authorizedSendersList.some((auth) => {
            const cleanAuth = auth.replace(/\D/g, '')
            return (
              pJidNorm === auth ||
              pJidNorm.indexOf(auth) !== -1 ||
              (cleanAuth && pDigits && pDigits.endsWith(cleanAuth))
            )
          })
          if (isSenderAuthorized || authorizedSendersList.length === 0) {
            detectedOrigin = 'humano_celular'
          } else {
            detectedOrigin = 'humano_celular'
          }
        }
      } else {
        detectedOrigin = 'desconhecido'
      }

      const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
      const newMsg = new Record(msgCol)
      newMsg.set('user_id', userId)
      if (accountId) newMsg.set('account_id', accountId)
      newMsg.set('instance_name', instanceName)
      newMsg.set('remote_jid', remoteJid)
      newMsg.set('from_me', fromMe)
      if (msgCol.fields.getByName('pending_ai_response')) {
        newMsg.set('pending_ai_response', pendingAiResponse)
      }
      newMsg.set('message_id', messageId)
      newMsg.set('push_name', pushName)
      newMsg.set('content', content)
      newMsg.set('message_type', msgType)
      newMsg.set('status', fromMe ? 'pending' : 'received')
      newMsg.set('timestamp', normalizedTs > 0 ? normalizedTs : currentTs)
      if (msgCol.fields.getByName('origin')) {
        newMsg.set('origin', detectedOrigin)
      }

      if (msgCol.fields.getByName('participant_jid')) {
        newMsg.set('participant_jid', participantJid)
      }
      if (msgCol.fields.getByName('participant_pushname')) {
        newMsg.set('participant_pushname', pushName)
      }
      if (msgCol.fields.getByName('is_forwarded')) {
        newMsg.set('is_forwarded', msg.isForwarded === true)
      }

      if (msg.linkPreview) {
        if (msgCol.fields.getByName('link_url')) {
          newMsg.set('link_url', msg.linkPreview.url)
          newMsg.set('link_title', msg.linkPreview.title)
          newMsg.set('link_description', msg.linkPreview.description)
          newMsg.set('link_thumbnail_b64', msg.linkPreview.thumbnail)
        }
      }

      $app.save(newMsg)

      // DETECÇÃO AUTOMÁTICA DE RESPOSTAS A AGENDAMENTOS (Anti-atropelamento: não dispara mensagens)
      // Se mensagem recebida do paciente (fromMe = false, !isGroup, texto não vazio),
      // verifica se há agendamento futuro para este paciente (pelo telefone/remote_jid).
      // =========================================================================
      // RESPOSTA FORA DO HORÁRIO + COLETA DO MOTIVO + PESQUISA DE SATISFAÇÃO
      // =========================================================================
      if (
        !fromMe &&
        !isGroup &&
        content &&
        (msgType === 'conversation' || msgType === 'extendedTextMessage')
      ) {
        try {
          var convForCheck = null
          try {
            convForCheck = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid = {:jid} && instance_name = {:name}',
              { jid: remoteJid, name: instanceName },
            )
          } catch (_) {}

          // 1. CAPTURA DE MOTIVO DE CONTATO SE A CONVERSA ESTIVER AGUARDANDO MOTIVO
          if (convForCheck && convForCheck.getBool('awaiting_contact_reason')) {
            var reasonText = content.trim()
            var rLower = reasonText.toLowerCase()
            var detectedCategory = 'outro'
            if (
              rLower.indexOf('consulta') !== -1 ||
              rLower.indexOf('agendar') !== -1 ||
              rLower.indexOf('marcar') !== -1
            ) {
              detectedCategory = 'consulta'
            } else if (rLower.indexOf('retorno') !== -1 || rLower.indexOf('reavalia') !== -1) {
              detectedCategory = 'retorno'
            } else if (
              rLower.indexOf('valor') !== -1 ||
              rLower.indexOf('preço') !== -1 ||
              rLower.indexOf('preco') !== -1 ||
              rLower.indexOf('quanto custa') !== -1
            ) {
              detectedCategory = 'valor'
            } else if (
              rLower.indexOf('exame') !== -1 ||
              rLower.indexOf('bioimped') !== -1 ||
              rLower.indexOf('sangue') !== -1
            ) {
              detectedCategory = 'exame'
            }

            try {
              var crmContactRec = $app.findFirstRecordByFilter(
                'crm_contacts',
                'jid = {:jid} || phone ~ {:ph}',
                { jid: remoteJid, ph: remoteJid.split('@')[0] },
              )
              if (crmContactRec) {
                crmContactRec.set('contact_reason', reasonText)
                crmContactRec.set('contact_reason_category', detectedCategory)
                $app.saveNoValidate(crmContactRec)
              }
            } catch (_) {}

            convForCheck.set('awaiting_contact_reason', false)
            $app.saveNoValidate(convForCheck)
          }

          // 2. CAPTURA DE RESPOSTA DA PESQUISA DE SATISFAÇÃO (PARSER NOTA 0-10 + FEEDBACK)
          if (convForCheck && convForCheck.getBool('awaiting_survey_response')) {
            var surveyScore = -1
            var surveyFeedback = ''
            var trimmedContent = content.trim()

            // Busca número de 0 a 10 no início ou no corpo
            var numMatch = trimmedContent.match(/\b(10|[0-9])\b/)
            if (numMatch) {
              surveyScore = parseInt(numMatch[1], 10)
              surveyFeedback = trimmedContent
                .replace(numMatch[0], '')
                .replace(/^[\s,.\-–—:]+/, '')
                .trim()
            } else {
              surveyFeedback = trimmedContent
            }

            var patDigits = remoteJid.split('@')[0].replace(/\D/g, '')
            var sSuf = patDigits.length > 8 ? patDigits.slice(-8) : patDigits
            var recentApp = null
            try {
              var sApps = $app.findRecordsByFilter(
                'appointments',
                '(patient_phone ~ {:suf} || patient_id.phone ~ {:suf}) && survey_sent = true',
                '-starts_at',
                1,
                0,
                { suf: sSuf },
              )
              if (sApps && sApps.length > 0) recentApp = sApps[0]
            } catch (_) {}

            try {
              var survCol = $app.findCollectionByNameOrId('satisfaction_surveys')
              var sRec = new Record(survCol)
              if (accountId) sRec.set('account_id', accountId)
              if (recentApp && recentApp.getString('patient_id')) {
                sRec.set('contact_id', recentApp.getString('patient_id'))
              }
              if (recentApp) {
                sRec.set('appointment_id', recentApp.id)
              }
              if (surveyScore >= 0 && surveyScore <= 10) {
                sRec.set('score', surveyScore)
              }
              sRec.set('feedback', surveyFeedback)
              sRec.set('recebida_em', new Date().toISOString())
              $app.save(sRec)
            } catch (sErr) {
              $app.logger().error('survey_save_error', 'err', String(sErr))
            }

            convForCheck.set('awaiting_survey_response', false)
            $app.saveNoValidate(convForCheck)
          }

          // 3. VERIFICAÇÃO DE RESPOSTA FORA DO HORÁRIO
          // Checar se recurso está ativo na conta e se KILL SWITCH global não está acionado
          var ahSettings = null
          if (accountId) {
            try {
              ahSettings = $app.findFirstRecordByFilter(
                'care_alert_settings',
                'account_id = {:aid}',
                { aid: accountId },
              )
            } catch (_) {}
          }
          if (!ahSettings) {
            try {
              ahSettings = $app.findFirstRecordByFilter('care_alert_settings', '')
            } catch (_) {}
          }
          var isKillSwitchPaused = ahSettings && ahSettings.getBool('global_automations_paused')
          var isAhEnabled =
            !isKillSwitchPaused && (!ahSettings || ahSettings.get('after_hours_enabled') !== false)

          if (isAhEnabled) {
            // Calcular data/hora atual no timezone de São Paulo (UTC-3)
            var nowUtc = new Date()
            var spMs = nowUtc.getTime() - 3 * 3600 * 1000
            var spDateObj = new Date(spMs)
            var spDay = spDateObj.getUTCDay() // 0..6
            var spHour = spDateObj.getUTCHours()
            var spMin = spDateObj.getUTCMinutes()
            var spHHMM = ('0' + spHour).slice(-2) + ':' + ('0' + spMin).slice(-2)

            // Buscar horários de business_hours da conta para este dia
            var isOpen = true
            try {
              var bhDay = $app.findFirstRecordByFilter(
                'business_hours',
                'account_id = {:aid} && dia_semana = {:d}',
                { aid: accountId, d: spDay },
              )
              if (bhDay) {
                if (!bhDay.getBool('ativo')) {
                  isOpen = false
                } else {
                  var openTime = bhDay.getString('abre') || '08:00'
                  var closeTime = bhDay.getString('fecha') || '18:00'
                  if (spHHMM < openTime || spHHMM >= closeTime) {
                    isOpen = false
                  }
                }
              } else {
                // Padrão: seg-sex 08:00-18:00, sáb 08:00-12:00, dom fechado
                if (spDay === 0) isOpen = false
                else if (spDay === 6 && (spHHMM < '08:00' || spHHMM >= '12:00')) isOpen = false
                else if (spDay >= 1 && spDay <= 5 && (spHHMM < '08:00' || spHHMM >= '18:00'))
                  isOpen = false
              }
            } catch (_) {}

            // Se estiver FORA do expediente:
            if (!isOpen) {
              // Anti-atropelamento humano: verificar se houve mensagem from_me nos últimos 60 minutos
              var sixtyMinAgoSec = Math.floor(Date.now() / 1000) - 3600
              var hasRecentStaffMsg = false
              try {
                var recentStaff = $app.findRecordsByFilter(
                  'whatsapp_messages',
                  'remote_jid = {:jid} && from_me = true && timestamp >= {:since}',
                  '-timestamp',
                  1,
                  0,
                  { jid: remoteJid, since: sixtyMinAgoSec },
                )
                if (recentStaff && recentStaff.length > 0) {
                  hasRecentStaffMsg = true
                }
              } catch (_) {}

              // Idempotência na janela fora do expediente:
              // Só envia se NÃO enviou resposta fora de horário nas últimas 12h
              var twelveHoursAgoIso = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
              var alreadySentInWindow = false
              if (convForCheck) {
                var lastAh = convForCheck.getString('last_after_hours_sent_at')
                if (lastAh && lastAh >= twelveHoursAgoIso) {
                  alreadySentInWindow = true
                }
              }

              if (!hasRecentStaffMsg && !alreadySentInWindow) {
                var patientGreetingName =
                  validPatientPushName ||
                  (convForCheck ? convForCheck.getString('contact_name') : '') ||
                  'Paciente'
                var pFirstName = patientGreetingName.trim().split(' ')[0]

                var afterHoursText =
                  'Olá, ' +
                  pFirstName +
                  '! Recebemos sua mensagem 💚 Neste momento a equipe do Dr. Caio está fora do horário de atendimento, mas já te respondemos no primeiro horário de amanhã. Enquanto isso, pode nos contar rapidinho o motivo do seu contato? (ex: consulta, retorno, valor, exame, outro)'

                // Disparar envio via Evolution API
                var evoUrl = $secrets.get('EVOLUTION_API_URL') || ''
                var evoKey = $secrets.get('EVOLUTION_API_KEY') || ''
                if (evoUrl && evoKey) {
                  var baseUrl = evoUrl.endsWith('/') ? evoUrl.slice(0, -1) : evoUrl
                  var cleanNum = remoteJid.split('@')[0].replace(/\D/g, '')
                  if (cleanNum.length === 10 || cleanNum.length === 11) cleanNum = '55' + cleanNum

                  try {
                    var sendRes = $http.send({
                      url: baseUrl + '/message/sendText/' + instanceName,
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', apikey: evoKey },
                      body: JSON.stringify({ number: cleanNum, text: afterHoursText }),
                      timeout: 15,
                    })

                    if (sendRes.statusCode >= 200 && sendRes.statusCode < 300) {
                      var outMsgId = 'ah_' + $security.randomString(16)
                      try {
                        outMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
                      } catch (_) {}

                      var ahMsgRecord = new Record(
                        $app.findCollectionByNameOrId('whatsapp_messages'),
                      )
                      ahMsgRecord.set('user_id', userId)
                      if (accountId) ahMsgRecord.set('account_id', accountId)
                      ahMsgRecord.set('instance_name', instanceName)
                      ahMsgRecord.set('remote_jid', remoteJid)
                      ahMsgRecord.set('from_me', true)
                      ahMsgRecord.set('message_id', outMsgId)
                      ahMsgRecord.set('push_name', 'Assistente')
                      ahMsgRecord.set('content', afterHoursText)
                      ahMsgRecord.set('message_type', 'conversation')
                      ahMsgRecord.set('status', 'pending')
                      ahMsgRecord.set('timestamp', Math.floor(Date.now() / 1000))
                      $app.save(ahMsgRecord)

                      if (convForCheck) {
                        convForCheck.set('last_after_hours_sent_at', new Date().toISOString())
                        convForCheck.set('awaiting_contact_reason', true)
                        convForCheck.set('last_message', afterHoursText)
                        convForCheck.set('last_message_timestamp', Math.floor(Date.now() / 1000))
                        $app.saveNoValidate(convForCheck)
                      }
                      $app
                        .logger()
                        .info('after_hours_reply_sent', 'jid', remoteJid, 'patient', pFirstName)
                    }
                  } catch (sendAhErr) {
                    $app.logger().error('after_hours_send_failed', 'err', String(sendAhErr))
                  }
                }
              }
            }
          }
        } catch (ahErr) {
          $app.logger().warn('after_hours_processing_error', 'err', String(ahErr))
        }
      }

      // DETECÇÃO AUTOMÁTICA DE CONFIRMAÇÃO / CANCELAMENTO DE AGENDAMENTOS NA CONVERSA
      // Regras pedidas pelo usuário (Dr. Caio / Fabiana CRM):
      // 1. Ao paciente confirmar horário + dia + local com a Fabiana -> direto para o preenchimento da agenda.
      // 2. IA aguarda todas as informações (data/hora pelo menos) para que não ocorra erros na agenda. Se faltar dado essencial, registra aviso e tarefa humana.
      // 3. Facilita nome completo e data de nascimento quando o paciente for novo (sem crm_contact).
      // 4. Anti-duplicação: não cria duplicado se já houver agendamento no mesmo dia/horário (atualiza).
      // 5. Cancelamento pelo paciente ("cancelar", "não vou poder", etc.) -> exclusão do nome na agenda local e push do cancelamento para a agenda externa.
      // 6. Anti-atropelamento: este recurso NÃO envia mensagens para o WhatsApp, apenas altera agenda, cria contato/tarefa/notificação.
      if (
        !fromMe &&
        !isGroup &&
        content &&
        (msgType === 'conversation' || msgType === 'extendedTextMessage')
      ) {
        try {
          var senderDigits = remoteJid.split('@')[0].replace(/\D/g, '')
          if (senderDigits && senderDigits.length >= 8) {
            var phoneSuffix = senderDigits.slice(-8)
            var nowIsoForApp = new Date().toISOString()
            var rawPatientText = content
            var cleanText = rawPatientText
              .toLowerCase()
              .replace(/[!?,.;:🙏✨👍😊❤️]/g, ' ')
              .trim()
            var words = cleanText.split(/\s+/)

            // 1. Verificar intenção de CANCELAMENTO
            var cancelPhrases = [
              'cancelar',
              'cancele',
              'cancela',
              'preciso cancelar',
              'quero cancelar',
              'nao vou poder',
              'não vou poder',
              'nao vou conseguir ir',
              'não vou conseguir ir',
              'nao poderei ir',
              'não poderei ir',
              'nao vou mais',
              'não vou mais',
              'desmarcar',
              'desmarque',
              'pode desmarcar',
              'preciso desmarcar',
              'excluir da agenda',
              'retirar meu nome',
            ]
            var isExplicitCancel = false
            for (var cpi = 0; cpi < cancelPhrases.length; cpi++) {
              if (cleanText.indexOf(cancelPhrases[cpi]) !== -1) {
                isExplicitCancel = true
                break
              }
            }

            // 2. Verificar intenção de CONFIRMAÇÃO
            var confirmPhrases = [
              'confirmo',
              'confirmado',
              'confirmada',
              'confirmar',
              'pode marcar',
              'pode agendar',
              'pode deixar marcado',
              'fechado',
              'fechou',
              'combinado',
              'vou sim',
              'vou com certeza',
              'estarei la',
              'estarei lá',
              'pode confirmar',
              'de acordo',
              'horario perfeito',
              'horário perfeito',
              'dia perfeito',
              'otimo horario',
              'ótimo horário',
            ]
            var isExplicitConfirm = false
            for (var cfi = 0; cfi < confirmPhrases.length; cfi++) {
              var term = confirmPhrases[cfi]
              if (term.indexOf(' ') !== -1) {
                if (cleanText.indexOf(term) !== -1) {
                  isExplicitConfirm = true
                  break
                }
              } else {
                if (words.indexOf(term) !== -1 || cleanText === term) {
                  isExplicitConfirm = true
                  break
                }
              }
            }
            // Palavras curtas que só contam como confirmação se o texto tiver menção de data/hora/local ou for estritamente resposta positiva
            if (!isExplicitConfirm && !isExplicitCancel) {
              if (
                words.indexOf('sim') !== -1 ||
                cleanText === 'ok' ||
                cleanText === 'vou' ||
                cleanText === 'pode'
              ) {
                isExplicitConfirm = true
              }
            }

            // Expressões de reagendamento / dúvida
            var reschedulePhrases = [
              'preciso remarcar',
              'remarcar',
              'remarca',
              'mudar horario',
              'mudar horário',
              'mudar data',
              'mudar o dia',
              'adiar',
              'outro dia',
              'outro horario',
              'outro horário',
            ]
            var isRescheduleIntent = false
            for (var rpi = 0; rpi < reschedulePhrases.length; rpi++) {
              if (cleanText.indexOf(reschedulePhrases[rpi]) !== -1) {
                isRescheduleIntent = true
                break
              }
            }

            // Buscar agendamentos futuros existentes do paciente
            var futureAppointments = $app.findRecordsByFilter(
              'appointments',
              '(patient_phone ~ {:suf} || patient_id.phone ~ {:suf} || patient_id.jid ~ {:suf}) && starts_at >= {:now} && status != "cancelado" && status != "realizado"',
              '+starts_at',
              5,
              0,
              { suf: phoneSuffix, now: nowIsoForApp },
            )

            // Buscar histórico recente da conversa (últimas 6 mensagens) para contextualizar data, hora e local ditos pela Fabiana ou pelo paciente
            var recentContextText = ''
            var recentMessages = []
            try {
              recentMessages = $app.findRecordsByFilter(
                'whatsapp_messages',
                'remote_jid = {:jid} && instance_name = {:name}',
                '-timestamp',
                6,
                0,
                { jid: remoteJid, name: instanceName },
              )
            } catch (_) {}

            var combinedTextForExtraction = rawPatientText + '\n'
            for (var rmi = 0; rmi < recentMessages.length; rmi++) {
              var rMsg = recentMessages[rmi]
              var rContent = rMsg.getString('content') || ''
              if (rContent) {
                combinedTextForExtraction += rContent + '\n'
                recentContextText += rContent + '\n'
              }
            }

            // Funções de extração de data, hora e local (Fuso America/Sao_Paulo UTC-3)
            function extractTime(text) {
              if (!text) return null
              // 1. "14:30" ou "14h30" ou "14h" ou "14 horas"
              var m = text.match(/(?:às|as|para\s+as|para\s+às)?\s*(\b[012]?\d)(?::|h)(\d{2})\b/i)
              if (m) {
                var h = parseInt(m[1], 10)
                var min = parseInt(m[2], 10)
                if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min }
              }
              var m2 = text.match(/(?:às|as|para\s+as|para\s+às)?\s*(\b[012]?\d)\s*h(?:oras)?\b/i)
              if (m2) {
                var h2 = parseInt(m2[1], 10)
                if (h2 >= 0 && h2 <= 23) return { hour: h2, minute: 0 }
              }
              // "duas da tarde", "três da tarde", "nove da manhã"
              var extMap = {
                uma: 13,
                duas: 14,
                tres: 15,
                três: 15,
                quatro: 16,
                cinco: 17,
                seis: 18,
                sete: 7,
                oito: 8,
                nove: 9,
                dez: 10,
                onze: 11,
                'meio dia': 12,
              }
              for (var k in extMap) {
                if (text.toLowerCase().indexOf(k + ' da tarde') !== -1) {
                  return { hour: extMap[k], minute: 0 }
                }
                if (
                  text.toLowerCase().indexOf(k + ' da manha') !== -1 ||
                  text.toLowerCase().indexOf(k + ' da manhã') !== -1
                ) {
                  var morningH = extMap[k] > 12 ? extMap[k] - 12 : extMap[k]
                  return { hour: morningH, minute: 0 }
                }
              }
              return null
            }

            function extractDateCivil(text) {
              if (!text) return null
              var nowMs = Date.now()
              // Ajuste de Brasília UTC-3
              var spNow = new Date(nowMs - 3 * 3600 * 1000)
              var curYear = spNow.getUTCFullYear()
              var curMonth = spNow.getUTCMonth() // 0-11
              var curDate = spNow.getUTCDate()
              var curDayOfWeek = spNow.getUTCDay() // 0=dom, 1=seg...

              var lower = text.toLowerCase()

              // Expressões relativas
              if (lower.indexOf('hoje') !== -1) {
                return { year: curYear, month: curMonth, day: curDate }
              }
              if (lower.indexOf('amanha') !== -1 || lower.indexOf('amanhã') !== -1) {
                var am = new Date(spNow.getTime() + 24 * 3600 * 1000)
                return { year: am.getUTCFullYear(), month: am.getUTCMonth(), day: am.getUTCDate() }
              }
              if (
                lower.indexOf('depois de amanha') !== -1 ||
                lower.indexOf('depois de amanhã') !== -1
              ) {
                var dam = new Date(spNow.getTime() + 48 * 3600 * 1000)
                return {
                  year: dam.getUTCFullYear(),
                  month: dam.getUTCMonth(),
                  day: dam.getUTCDate(),
                }
              }

              // Dias da semana: "segunda", "terça", "quarta", "quinta", "sexta", "sábado"
              var weekDays = {
                domingo: 0,
                segunda: 1,
                terca: 2,
                terça: 2,
                quarta: 3,
                quinta: 4,
                sexta: 5,
                sabado: 6,
                sábado: 6,
              }
              for (var wd in weekDays) {
                if (lower.indexOf(wd) !== -1) {
                  var targetDow = weekDays[wd]
                  var diff = (targetDow - curDayOfWeek + 7) % 7
                  if (diff === 0) diff = 7 // Próxima ocorrência
                  var targetDate = new Date(spNow.getTime() + diff * 24 * 3600 * 1000)
                  return {
                    year: targetDate.getUTCFullYear(),
                    month: targetDate.getUTCMonth(),
                    day: targetDate.getUTCDate(),
                  }
                }
              }

              // dd/MM ou dd/MM/yyyy
              var dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
              if (dateMatch) {
                var d = parseInt(dateMatch[1], 10)
                var m = parseInt(dateMatch[2], 10) - 1
                var y = dateMatch[3] ? parseInt(dateMatch[3], 10) : curYear
                if (y < 100) y += 2000
                if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
                  return { year: y, month: m, day: d }
                }
              }

              // "dia 15", "dia 20 de outubro"
              var diaMatch = text.match(/\bdia\s+(\d{1,2})(?:\s+de\s+([a-zçã]+))?\b/i)
              if (diaMatch) {
                var dNum = parseInt(diaMatch[1], 10)
                var mNum = curMonth
                var monthNames = {
                  janeiro: 0,
                  fevereiro: 1,
                  marco: 2,
                  março: 2,
                  abril: 3,
                  maio: 4,
                  junho: 5,
                  julho: 6,
                  agosto: 7,
                  setembro: 8,
                  outubro: 9,
                  novembro: 10,
                  dezembro: 11,
                }
                if (diaMatch[2] && monthNames[diaMatch[2].toLowerCase()] !== undefined) {
                  mNum = monthNames[diaMatch[2].toLowerCase()]
                } else if (dNum < curDate) {
                  // Se o dia já passou no mês corrente, assume próximo mês
                  mNum = (curMonth + 1) % 12
                }
                var yr = curYear
                if (mNum < curMonth) yr += 1
                if (dNum >= 1 && dNum <= 31) {
                  return { year: yr, month: mNum, day: dNum }
                }
              }

              return null
            }

            function extractLocation(text) {
              if (!text) return { city: 'Carmo do Rio Claro', location: 'Climed' }
              var lower = text.toLowerCase()
              if (lower.indexOf('monte belo') !== -1) {
                return { city: 'Monte Belo', location: 'Monte Belo' }
              }
              if (lower.indexOf('alfenas') !== -1 || lower.indexOf('harmoniza') !== -1) {
                return { city: 'Alfenas', location: 'Instituto Harmoniza' }
              }
              if (
                lower.indexOf('online') !== -1 ||
                lower.indexOf('remoto') !== -1 ||
                lower.indexOf('distancia') !== -1 ||
                lower.indexOf('distância') !== -1
              ) {
                return { city: 'Online', location: 'Atendimento Online' }
              }
              if (lower.indexOf('carmo') !== -1 || lower.indexOf('climed') !== -1) {
                return { city: 'Carmo do Rio Claro', location: 'Climed' }
              }
              return { city: 'Carmo do Rio Claro', location: 'Climed' }
            }

            function extractBirthDateFromText(text) {
              if (!text) return ''
              // Formatos comuns: "15/09/1990", "nascido em 12/04/1985", "data de nascimento: 05/11/1998", "nascimento 20/03/88"
              var m = text.match(
                /(?:nasc(?:imento|ido)?(?:\s+em)?[:\s]*)?\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i,
              )
              if (m) {
                var d = m[1].length === 1 ? '0' + m[1] : m[1]
                var mo = m[2].length === 1 ? '0' + m[2] : m[2]
                var y = m[3]
                if (y.length === 2) y = parseInt(y, 10) > 30 ? '19' + y : '20' + y
                return d + '/' + mo + '/' + y
              }
              return ''
            }

            function extractFullNameFromText(text, fallback) {
              if (!text) return fallback || 'Paciente'
              // Procura padrões como "meu nome é [Nome Completo]", "nome: [Nome Completo]", "sou [Nome]"
              var m = text.match(
                /(?:meu\s+nome\s+é|meu\s+nome\s+e|nome:\s*|sou\s+(?:o|a)?\s*)([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][a-záéíóúâêîôûãõç]+)+)/i,
              )
              if (m && m[1]) return m[1].trim()
              return fallback || 'Paciente'
            }

            // CENÁRIO A: CANCELAMENTO DO PACIENTE
            // Usuário pediu: "caso ocorra o cancelamento, ocorre a exclusão do nome na agenda"
            if (isExplicitCancel && futureAppointments && futureAppointments.length > 0) {
              var appToCancel = futureAppointments[0]
              var patientDisplay = appToCancel.getString('patient_name') || 'Paciente'
              var cancelStart = appToCancel.getString('starts_at')
              var cancelExternalId = appToCancel.getString('external_id')

              // Notificação para o painel de contexto e equipe humana
              try {
                var nColCancel = $app.findCollectionByNameOrId('notifications')
                var cancelNotif = new Record(nColCancel)
                if (accountId) cancelNotif.set('account_id', accountId)
                cancelNotif.set('type', 'care_alert')
                cancelNotif.set('title', 'Consulta cancelada pelo paciente: ' + patientDisplay)
                cancelNotif.set(
                  'body',
                  'Agendamento de ' +
                    cancelStart +
                    ' foi removido da agenda após confirmação de cancelamento pelo WhatsApp: "' +
                    rawPatientText.substring(0, 100) +
                    '".',
                )
                if (appToCancel.getString('patient_id'))
                  cancelNotif.set('crm_contact_id', appToCancel.getString('patient_id'))
                if (appToCancel.getString('conversation_id'))
                  cancelNotif.set('conversation_id', appToCancel.getString('conversation_id'))
                cancelNotif.set('read', false)
                try {
                  var accMemC = $app.findFirstRecordByFilter(
                    'account_members',
                    'account_id = {:aid}',
                    { aid: accountId },
                  )
                  if (accMemC) cancelNotif.set('user_id', accMemC.getString('user_id'))
                } catch (_) {}
                $app.save(cancelNotif)
              } catch (nErr) {
                $app
                  .logger()
                  .warn('webhook_appointment: cancel notification error', 'err', String(nErr))
              }

              // Push da exclusão/cancelamento para a agenda externa antes de deletar do PocketBase
              if (cancelExternalId) {
                try {
                  var RECOMMENDED_BASE_URL =
                    'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
                  var rawUrl = (
                    $secrets.get('AGENDA_SYNC_URL') ||
                    $os.getenv('AGENDA_SYNC_URL') ||
                    ''
                  ).trim()
                  var rawToken =
                    (
                      $secrets.get('AGENDA_CRM_TOKEN') ||
                      $os.getenv('AGENDA_CRM_TOKEN') ||
                      ''
                    ).trim() || 'crm_agenda_token_dr_caio_2026'
                  var effBase =
                    rawUrl && rawUrl.indexOf('agendanutri.goskip.app') === -1
                      ? rawUrl
                      : RECOMMENDED_BASE_URL
                  if (effBase.indexOf('/backend/v1/crm-dados') !== -1) {
                    effBase = effBase.slice(0, effBase.indexOf('/backend/v1/crm-dados'))
                  }
                  if (effBase.endsWith('/')) effBase = effBase.slice(0, -1)

                  // Rota oficial da agenda externa para cancelamento/exclusão (soft-delete, sem permanente=true)
                  var delRes = $http.send({
                    url: effBase + '/backend/v1/crm-agendamento/' + cancelExternalId,
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                      'X-CRM-Token': rawToken,
                    },
                    timeout: 4,
                  })
                  if (delRes.statusCode < 200 || delRes.statusCode >= 300) {
                    // Fallback se DELETE falhar: marca status=cancelado lá via PATCH
                    $http.send({
                      url: effBase + '/backend/v1/crm-agendamento/' + cancelExternalId,
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'X-CRM-Token': rawToken,
                      },
                      body: JSON.stringify({ status: 'cancelado' }),
                      timeout: 4,
                    })
                  }
                } catch (pushDelErr) {
                  $app
                    .logger()
                    .warn(
                      'webhook_appointment: external cancel push error',
                      'err',
                      String(pushDelErr),
                    )
                }
              }

              // Excluir da agenda local (palavra do usuário: "ocorre a exclusão do nome na agenda")
              try {
                $app.delete(appToCancel)
                $app
                  .logger()
                  .info(
                    'webhook_appointment: deleted appointment by patient cancellation',
                    'app_id',
                    appToCancel.id,
                    'patient',
                    patientDisplay,
                  )
              } catch (delErr) {
                // Se falhar o delete, marca como cancelado
                appToCancel.set('status', 'cancelado')
                appToCancel.set('last_interaction_type', 'cancelado_paciente')
                $app.saveNoValidate(appToCancel)
              }
            } else if (isRescheduleIntent && futureAppointments && futureAppointments.length > 0) {
              // CENÁRIO B: PEDIDO DE REMARCAÇÃO / REAGENDAMENTO
              var targetAppResched = futureAppointments[0]
              targetAppResched.set('status', 'remarcado')
              targetAppResched.set('last_interaction_type', 'remarcado_paciente')
              $app.saveNoValidate(targetAppResched)
              $app
                .logger()
                .info('webhook_appointment: rescheduled by patient', 'app_id', targetAppResched.id)

              // Criar tarefa humana para a Fabiana remarcar
              try {
                var pNameR = targetAppResched.getString('patient_name') || 'Paciente'
                var tColR = $app.findCollectionByNameOrId('tasks')
                var reschedTaskRec = new Record(tColR)
                reschedTaskRec.set('title', 'Reagendar consulta: ' + pNameR)
                reschedTaskRec.set(
                  'description',
                  'Paciente solicitou alteração do agendamento marcado para ' +
                    targetAppResched.getString('starts_at') +
                    '. Mensagem: "' +
                    rawPatientText.substring(0, 150) +
                    '". Verificar nova disponibilidade com o Dr. Caio.',
                )
                reschedTaskRec.set('status', 'pendente')
                reschedTaskRec.set('priority', 'alta')
                reschedTaskRec.set('care_category', 'precisa_retorno')
                if (accountId) reschedTaskRec.set('account_id', accountId)
                var pIdR = targetAppResched.getString('patient_id')
                if (pIdR) reschedTaskRec.set('crm_contact_id', pIdR)
                var cIdR = targetAppResched.getString('conversation_id')
                if (cIdR) reschedTaskRec.set('conversation_id', cIdR)
                try {
                  var accMemR = $app.findFirstRecordByFilter(
                    'account_members',
                    'account_id = {:aid}',
                    { aid: accountId },
                  )
                  if (accMemR) reschedTaskRec.set('user_id', accMemR.getString('user_id'))
                } catch (_) {}
                $app.save(reschedTaskRec)

                var nColR = $app.findCollectionByNameOrId('notifications')
                var reschedNotifRec = new Record(nColR)
                if (reschedTaskRec.getString('user_id'))
                  reschedNotifRec.set('user_id', reschedTaskRec.getString('user_id'))
                if (accountId) reschedNotifRec.set('account_id', accountId)
                reschedNotifRec.set('type', 'task')
                reschedNotifRec.set('title', 'Paciente solicitou reagendamento: ' + pNameR)
                reschedNotifRec.set(
                  'body',
                  'Paciente solicitou alteração: "' + rawPatientText.substring(0, 100) + '"',
                )
                reschedNotifRec.set('task_id', reschedTaskRec.id)
                if (pIdR) reschedNotifRec.set('crm_contact_id', pIdR)
                if (cIdR) reschedNotifRec.set('conversation_id', cIdR)
                reschedNotifRec.set('read', false)
                $app.save(reschedNotifRec)
              } catch (tCreateErr) {
                $app
                  .logger()
                  .error(
                    'webhook_appointment: create reschedule task failed',
                    'error',
                    String(tCreateErr),
                  )
              }
            } else if (isExplicitConfirm) {
              // CENÁRIO C: CONFIRMAÇÃO DA CONSULTA PELO PACIENTE
              // Usuário pediu:
              // - "Ao paciente confirmar a consulta com o horário e o dia e o local do atendimento com a Fabiana, mandando, vai direto para o preenchimento da agenda"
              // - "facilitando o nome completo e data de nascimento quando o paciente for novo"
              // - "A IA aguarda todas as informações para que não ocorra erros na agenda"
              // - "caso já exista agendamento, atualizar em vez de duplicar"

              // Se já temos um agendamento futuro para este paciente:
              // Regra de negócio: confirmação do paciente seta status='aguardando' + last_interaction_type='confirmado_paciente'
              // Push para agenda externa é acionado apenas na ação manual da Fabiana.
              if (futureAppointments && futureAppointments.length > 0) {
                var curApp = futureAppointments[0]
                curApp.set('status', 'aguardando')
                curApp.set('last_interaction_type', 'confirmado_paciente')
                $app.saveNoValidate(curApp)
                $app
                  .logger()
                  .info(
                    'webhook_appointment: confirmed existing appointment by patient (status=aguardando, confirmed_patient)',
                    'app_id',
                    curApp.id,
                  )

                // Cria notificação de visibilidade no chat / equipe
                try {
                  var nColConf = $app.findCollectionByNameOrId('notifications')
                  var confNotif = new Record(nColConf)
                  if (accountId) confNotif.set('account_id', accountId)
                  confNotif.set('type', 'message')
                  confNotif.set(
                    'title',
                    'Consulta confirmada pelo paciente: ' +
                      (curApp.getString('patient_name') || 'Paciente'),
                  )
                  confNotif.set(
                    'body',
                    'Agendamento confirmado para ' +
                      curApp.getString('starts_at') +
                      ' (' +
                      (curApp.getString('location') || curApp.getString('city')) +
                      ').',
                  )
                  if (curApp.getString('patient_id'))
                    confNotif.set('crm_contact_id', curApp.getString('patient_id'))
                  if (curApp.getString('conversation_id'))
                    confNotif.set('conversation_id', curApp.getString('conversation_id'))
                  confNotif.set('read', false)
                  try {
                    var accMemConf = $app.findFirstRecordByFilter(
                      'account_members',
                      'account_id = {:aid}',
                      { aid: accountId },
                    )
                    if (accMemConf) confNotif.set('user_id', accMemConf.getString('user_id'))
                  } catch (_) {}
                  $app.save(confNotif)
                } catch (_) {}
              } else {
                // Não há agendamento futuro marcado ainda! Extrair data, hora e local da conversa
                var parsedTime = extractTime(combinedTextForExtraction)
                var parsedDate = extractDateCivil(combinedTextForExtraction)
                var locInfo = extractLocation(combinedTextForExtraction)

                // SEGURANÇA ANTI-ERRO: "A IA aguarda todas as informações para que não ocorra erros na agenda"
                // Se faltar data OU hora legível, NÃO inventar nem criar agendamento errado.
                if (!parsedDate || !parsedTime) {
                  $app
                    .logger()
                    .info(
                      'webhook_appointment: missing date or time for confirmation, creating completion task',
                      'jid',
                      remoteJid,
                    )
                  try {
                    var missingDesc = []
                    if (!parsedDate) missingDesc.push('dia/data')
                    if (!parsedTime) missingDesc.push('horário')

                    var contactForMissing = null
                    try {
                      contactForMissing = $app.findFirstRecordByFilter(
                        'crm_contacts',
                        'phone ~ {:suf} || jid ~ {:suf}',
                        { suf: phoneSuffix },
                      )
                    } catch (_) {}

                    var patientMissingName =
                      validPatientPushName ||
                      (contactForMissing ? contactForMissing.getString('contact_name') : '') ||
                      'Paciente'

                    var tColMissing = $app.findCollectionByNameOrId('tasks')
                    var missingTask = new Record(tColMissing)
                    missingTask.set(
                      'title',
                      'Dados incompletos para agendamento: ' + patientMissingName,
                    )
                    missingTask.set(
                      'description',
                      'Paciente tentou confirmar consulta mas faltam dados essenciais (' +
                        missingDesc.join(', ') +
                        '). Mensagem do paciente: "' +
                        rawPatientText.substring(0, 150) +
                        '". Verificar na conversa com a Fabiana para preencher a agenda.',
                    )
                    missingTask.set('status', 'pendente')
                    missingTask.set('priority', 'alta')
                    missingTask.set('care_category', 'precisa_consulta')
                    if (accountId) missingTask.set('account_id', accountId)
                    if (contactForMissing) missingTask.set('crm_contact_id', contactForMissing.id)
                    try {
                      var convMissing = $app.findFirstRecordByFilter(
                        'conversations',
                        'remote_jid = {:jid}',
                        { jid: remoteJid },
                      )
                      if (convMissing) missingTask.set('conversation_id', convMissing.id)
                    } catch (_) {}
                    try {
                      var accMemM = $app.findFirstRecordByFilter(
                        'account_members',
                        'account_id = {:aid}',
                        { aid: accountId },
                      )
                      if (accMemM) missingTask.set('user_id', accMemM.getString('user_id'))
                    } catch (_) {}
                    $app.save(missingTask)

                    // Notificação de aviso
                    var nColM = $app.findCollectionByNameOrId('notifications')
                    var notifM = new Record(nColM)
                    if (missingTask.getString('user_id'))
                      notifM.set('user_id', missingTask.getString('user_id'))
                    if (accountId) notifM.set('account_id', accountId)
                    notifM.set('type', 'care_alert')
                    notifM.set('title', 'Agendamento pendente de dados: ' + patientMissingName)
                    notifM.set(
                      'body',
                      'Paciente confirmou mas falta ' +
                        missingDesc.join(' e ') +
                        '. Verifique o chat.',
                    )
                    notifM.set('task_id', missingTask.id)
                    if (contactForMissing) notifM.set('crm_contact_id', contactForMissing.id)
                    notifM.set('read', false)
                    $app.save(notifM)
                  } catch (missErr) {
                    $app
                      .logger()
                      .warn(
                        'webhook_appointment: missing info handler error',
                        'err',
                        String(missErr),
                      )
                  }
                } else {
                  // TEM TODAS AS INFORMAÇÕES: Data + Hora + Local!
                  // Converter para ISO UTC considerando fuso America/Sao_Paulo (UTC-3):
                  // starts_at UTC = Date.UTC(year, month, day, hour + 3, minute, 0)
                  var utcStartMs = Date.UTC(
                    parsedDate.year,
                    parsedDate.month,
                    parsedDate.day,
                    parsedTime.hour + 3,
                    parsedTime.minute,
                    0,
                  )
                  var newStartsAtIso = new Date(utcStartMs).toISOString()
                  var newEndsAtIso = new Date(utcStartMs + 45 * 60 * 1000).toISOString()

                  // Verificar e gerenciar Contato no CRM (Paciente Novo ou Existente)
                  var contactRec = null
                  try {
                    contactRec = $app.findFirstRecordByFilter(
                      'crm_contacts',
                      'phone ~ {:suf} || jid ~ {:suf}',
                      { suf: phoneSuffix },
                    )
                  } catch (_) {}

                  var extractedBirthDate = extractBirthDateFromText(combinedTextForExtraction)
                  var extractedName = extractFullNameFromText(
                    combinedTextForExtraction,
                    validPatientPushName ||
                      (contactRec ? contactRec.getString('contact_name') : 'Paciente'),
                  )

                  if (!contactRec) {
                    // PACIENTE NOVO: Criar crm_contact facilitando nome e data de nascimento
                    try {
                      var crmCol = $app.findCollectionByNameOrId('crm_contacts')
                      contactRec = new Record(crmCol)
                      contactRec.set('user_id', userId)
                      if (accountId) contactRec.set('account_id', accountId)
                      contactRec.set('instance_name', instanceName)
                      contactRec.set('jid', remoteJid)
                      contactRec.set('phone', senderDigits)
                      contactRec.set('push_name', validPatientPushName || '')
                      contactRec.set('contact_name', extractedName)
                      contactRec.set('is_patient', true)
                      contactRec.set('stage', 'cliente')
                      contactRec.set('care_status', 'precisa_consulta')
                      if (extractedBirthDate) {
                        contactRec.set('birth_date', extractedBirthDate)
                      }
                      $app.save(contactRec)
                      $app
                        .logger()
                        .info(
                          'webhook_appointment: new patient crm_contact created',
                          'name',
                          extractedName,
                          'birth',
                          extractedBirthDate,
                        )
                    } catch (cCreateErr) {
                      $app
                        .logger()
                        .warn(
                          'webhook_appointment: failed to create new crm_contact',
                          'err',
                          String(cCreateErr),
                        )
                    }
                  } else {
                    // Contato existente: atualizar nome ou data de nascimento se surgiram na conversa
                    var updatedContact = false
                    if (
                      (!contactRec.getString('contact_name') ||
                        contactRec.getString('contact_name') === 'Novo Contato' ||
                        contactRec.getString('contact_name') === 'Paciente') &&
                      extractedName &&
                      extractedName !== 'Paciente'
                    ) {
                      contactRec.set('contact_name', extractedName)
                      updatedContact = true
                    }
                    if (extractedBirthDate && !contactRec.getString('birth_date')) {
                      contactRec.set('birth_date', extractedBirthDate)
                      updatedContact = true
                    }
                    if (!contactRec.getBool('is_patient')) {
                      contactRec.set('is_patient', true)
                      updatedContact = true
                    }
                    if (updatedContact) {
                      try {
                        $app.save(contactRec)
                      } catch (_) {}
                    }
                  }

                  var finalPatientName =
                    (contactRec ? contactRec.getString('contact_name') : '') ||
                    extractedName ||
                    validPatientPushName ||
                    'Paciente'

                  // Anti-duplicação: verificar se já existe agendamento deste paciente no mesmo dia/horário (margem de 2 horas)
                  var startWindowMs = utcStartMs - 2 * 3600 * 1000
                  var endWindowMs = utcStartMs + 2 * 3600 * 1000
                  var existingSameDay = null
                  try {
                    existingSameDay = $app.findFirstRecordByFilter(
                      'appointments',
                      '(patient_phone ~ {:suf} || patient_id = {:pid}) && starts_at >= {:winStart} && starts_at <= {:winEnd}',
                      {
                        suf: phoneSuffix,
                        pid: contactRec ? contactRec.id : '',
                        winStart: new Date(startWindowMs).toISOString(),
                        winEnd: new Date(endWindowMs).toISOString(),
                      },
                    )
                  } catch (_) {}

                  var convForAppId = ''
                  try {
                    var cRec = $app.findFirstRecordByFilter(
                      'conversations',
                      'remote_jid = {:jid}',
                      { jid: remoteJid },
                    )
                    if (cRec) convForAppId = cRec.id
                  } catch (_) {}

                  var appToSave = existingSameDay
                  if (!appToSave) {
                    var appCol = $app.findCollectionByNameOrId('appointments')
                    appToSave = new Record(appCol)
                    appToSave.set('source', 'crm')
                    appToSave.set('doctor', 'Dr. Caio')
                  }

                  if (accountId) appToSave.set('account_id', accountId)
                  appToSave.set('patient_name', finalPatientName)
                  appToSave.set('patient_phone', senderDigits)
                  if (contactRec) appToSave.set('patient_id', contactRec.id)
                  if (convForAppId) appToSave.set('conversation_id', convForAppId)
                  appToSave.set('city', locInfo.city)
                  appToSave.set('location', locInfo.location)
                  appToSave.set('starts_at', newStartsAtIso)
                  appToSave.set('ends_at', newEndsAtIso)
                  appToSave.set('status', 'aguardando')
                  appToSave.set('appointment_type', 'Consulta')
                  appToSave.set('last_interaction_type', 'confirmado_paciente')
                  appToSave.set(
                    'notes',
                    'Confirmação registrada pelo paciente no WhatsApp. Aguardando liberação manual da Fabiana.',
                  )
                  $app.save(appToSave)

                  $app
                    .logger()
                    .info(
                      'webhook_appointment: appointment created/updated by patient confirmation',
                      'id',
                      appToSave.id,
                      'patient',
                      finalPatientName,
                      'starts_at',
                      newStartsAtIso,
                    )

                  // Criar notificação para visibilidade imediata no painel / equipe
                  try {
                    var nColSuccess = $app.findCollectionByNameOrId('notifications')
                    var notifSuccess = new Record(nColSuccess)
                    if (accountId) notifSuccess.set('account_id', accountId)
                    notifSuccess.set('type', 'message')
                    notifSuccess.set(
                      'title',
                      'Consulta agendada pela confirmação do paciente: ' + finalPatientName,
                    )
                    notifSuccess.set(
                      'body',
                      'Agendamento confirmado para ' +
                        newStartsAtIso.substring(0, 10) +
                        ' às ' +
                        (parsedTime.hour < 10 ? '0' + parsedTime.hour : parsedTime.hour) +
                        ':' +
                        (parsedTime.minute < 10 ? '0' + parsedTime.minute : parsedTime.minute) +
                        ', ' +
                        locInfo.location +
                        ' (' +
                        locInfo.city +
                        ').',
                    )
                    if (contactRec) notifSuccess.set('crm_contact_id', contactRec.id)
                    if (convForAppId) notifSuccess.set('conversation_id', convForAppId)
                    notifSuccess.set('read', false)
                    try {
                      var accMemS = $app.findFirstRecordByFilter(
                        'account_members',
                        'account_id = {:aid}',
                        { aid: accountId },
                      )
                      if (accMemS) notifSuccess.set('user_id', accMemS.getString('user_id'))
                    } catch (_) {}
                    $app.save(notifSuccess)
                  } catch (nErrS) {
                    $app
                      .logger()
                      .warn('webhook_appointment: success notification error', 'err', String(nErrS))
                  }
                }
              }
            }
          }
        } catch (appCheckErr) {
          $app
            .logger()
            .warn('webhook_appointment: confirmation detection error', 'error', String(appCheckErr))
        }
      }

      if (msg.extractedMedia) {
        if (msg.extractedMedia.base64) {
          try {
            $app
              .logger()
              .info('media_decode_start', 'base64_length', msg.extractedMedia.base64.length)

            let b64 = msg.extractedMedia.base64
            if (b64.indexOf(',') !== -1) b64 = b64.split(',')[1]

            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
            const lookup = new Uint8Array(256)
            for (let i = 0; i < chars.length; i++) {
              lookup[chars.charCodeAt(i)] = i
            }
            let bufferLength = b64.length * 0.75
            if (b64[b64.length - 1] === '=') {
              bufferLength--
              if (b64[b64.length - 2] === '=') bufferLength--
            }
            const bytes = new Uint8Array(bufferLength)
            let p = 0
            for (let i = 0; i < b64.length; i += 4) {
              const encoded1 = lookup[b64.charCodeAt(i)]
              const encoded2 = lookup[b64.charCodeAt(i + 1)]
              const encoded3 = lookup[b64.charCodeAt(i + 2)]
              const encoded4 = lookup[b64.charCodeAt(i + 3)]

              bytes[p++] = (encoded1 << 2) | (encoded2 >> 4)
              if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2)
              if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63)
            }

            let ext = ''
            const mimeParts = (msg.extractedMedia.mimetype || '').split(';')[0].split('/')
            if (mimeParts.length === 2 && mimeParts[1]) {
              ext = '.' + mimeParts[1]
              if (ext === '.vnd.whatsapp.audio') ext = '.ogg'
            }

            let rawFilename = msg.extractedMedia.filename || 'media_' + Date.now()
            if (rawFilename.toLowerCase().endsWith(ext.toLowerCase())) {
              rawFilename = rawFilename.substring(0, rawFilename.length - ext.length)
            }

            let safeFilename = rawFilename.replace(/[^a-zA-Z0-9.\-_]/g, '')
            if (!safeFilename) safeFilename = 'media_' + Date.now()
            if (safeFilename.length > 200) safeFilename = safeFilename.substring(0, 200)
            const finalFilename = safeFilename + ext

            const f = $filesystem.fileFromBytes(bytes, finalFilename)
            newMsg.set('media_file', f)
            newMsg.set('media_mimetype', msg.extractedMedia.mimetype)
            newMsg.set('media_filename', finalFilename)

            // Se for áudio histórico antigo (> 7 dias), marcar SKIP_NO_TRANSCRIBE logo no salvamento
            if (
              (msgType === 'audioMessage' || msgType === 'audio' || ext === '.ogg') &&
              msgAge > 7 * 86400
            ) {
              newMsg.set('transcription', 'SKIP_NO_TRANSCRIBE')
            }

            $app.save(newMsg)

            const savedFile = newMsg.getString('media_file')
            if (savedFile) {
              const pbUrl = $secrets.get('PB_INSTANCE_URL') || ''
              const u = pbUrl.endsWith('/') ? pbUrl.slice(0, -1) : pbUrl
              const relativeUrl = '/api/files/whatsapp_messages/' + newMsg.id + '/' + savedFile
              const finalUrl = u ? u + relativeUrl : relativeUrl

              newMsg.set('media_url', finalUrl)
              $app.saveNoValidate(newMsg)
            } else {
              newMsg.set('status', 'media_failed')
              $app.saveNoValidate(newMsg)
            }
          } catch (err) {
            newMsg.set('status', 'media_failed')
            $app.saveNoValidate(newMsg)
          }
        } else {
          newMsg.set('status', 'media_failed')
          $app.saveNoValidate(newMsg)
        }
      }

      let fallbackText = content
      if (!fallbackText && msgType) {
        if (msgType.includes('image')) fallbackText = '[image]'
        else if (msgType.includes('video')) fallbackText = '[video]'
        else if (msgType.includes('audio')) fallbackText = '[audio]'
        else if (msgType.includes('document')) fallbackText = '[document]'
        else if (msgType.includes('sticker')) fallbackText = '[sticker]'
      }

      // Não saveamos a conversation aqui — apenas registramos no
      // acumulador. flushConvUpdates() (chamado ao fim do batch) faz 1
      // save por remote_jid distinto, o que reduz IO no banco e flood
      // de eventos SSE em ordens de magnitude durante import histórico.
      recordConvUpdate({
        remoteJid,
        isGroup,
        ts: normalizedTs,
        fromMe,
        fallbackText,
        pushName: validPatientPushName,
      })
    }

    if (event === 'connection.update') {
      const state = data?.state
      if (state === 'open' || state === 'connected') {
        instanceRecord.set('status', 'connected')
        // Limpar QR cache — não precisamos mais dele depois de pareado
        if (instanceRecord.fields && instanceRecord.fields.getByName) {
          // noop helper guard
        }
        try {
          instanceRecord.set('qrcode_base64', '')
        } catch (_) {}
        $app.save(instanceRecord)
        configureWebhook(instanceName)
      } else if (state === 'close' || state === 'disconnected') {
        // Não sobrescrever 'qrcode' quando há re-pareamento em andamento.
        // Isso evita corrida: o webhook close (do logout no reimport) chega
        // depois que o endpoint reimport-history já setou status='qrcode'
        // com QR fresco, e o front fica oscilando entre qrcode/disconnected.
        let currentQr = ''
        try {
          currentQr = instanceRecord.getString('qrcode_base64') || ''
        } catch (_) {}
        const currentStatus = instanceRecord.getString('status')
        if (currentStatus === 'qrcode' && currentQr) {
          // re-pareamento em curso, ignorar este close
        } else {
          instanceRecord.set('status', 'disconnected')
          $app.save(instanceRecord)
        }
      }
    } else if (event === 'qrcode.updated') {
      instanceRecord.set('status', 'qrcode')
      // Cachear o novo QR para o front mostrar sem regenerar a cada poll
      let newQr = ''
      try {
        if (data) {
          if (data.qrcode && data.qrcode.base64) newQr = data.qrcode.base64
          else if (data.base64) newQr = data.base64
          else if (data.qrcode && data.qrcode.code) newQr = data.qrcode.code
        }
      } catch (_) {}
      if (newQr) {
        try {
          instanceRecord.set('qrcode_base64', newQr)
        } catch (_) {}
      }
      $app.save(instanceRecord)
    } else if (event === 'messages.upsert') {
      if (Array.isArray(data?.messages)) {
        for (const msg of data.messages) {
          processMessage(msg)
        }
      } else if (data) {
        processMessage(data)
      }
      flushConvUpdates()
    } else if (event === 'messages.update') {
      if (Array.isArray(data)) {
        for (const update of data) {
          const msgId = update.key?.id
          if (!msgId) continue

          try {
            const msgRecord = $app.findFirstRecordByFilter(
              'whatsapp_messages',
              'message_id = {:msgId} && instance_name = {:name}',
              { msgId, name: instanceName },
            )

            const s = update.update?.status
            if (s !== undefined) {
              const statusMap = {
                1: 'pending',
                2: 'server_ack',
                3: 'delivery_ack',
                4: 'read',
                5: 'played',
              }
              if (statusMap[s]) {
                msgRecord.set('status', statusMap[s])
              }
            }

            const editedMsg = update.update?.message
            if (editedMsg) {
              if (editedMsg.conversation) {
                msgRecord.set('content', editedMsg.conversation)
              } else if (editedMsg.extendedTextMessage?.text) {
                msgRecord.set('content', editedMsg.extendedTextMessage.text)
              }
            }
            $app.save(msgRecord)
          } catch (_) {}
        }
      }
    } else if (event === 'messages.set') {
      const messages = Array.isArray(data?.messages)
        ? data.messages
        : Array.isArray(data)
          ? data
          : []
      // Aumentado de 50 para 500 — quando syncFullHistory está ativo, o Baileys
      // entrega histórico via messages.set em batches grandes. 500 é o teto por
      // batch para evitar travar o webhook por muito tempo (Goja é single-thread).
      const toProcess = messages.slice(0, 500)

      // Filtrar pelo período escolhido pelo usuário (sync_period_days).
      // 0 = importar tudo. Outros valores = só msgs com timestamp >= now - dias.
      // Filtramos AQUI no Conectado porque a Evolution/Baileys não aceita
      // filtro de período no syncFullHistory.
      const syncPeriodDays = instanceRecord.getInt('sync_period_days') || 0
      const cutoffTs =
        syncPeriodDays > 0 ? Math.floor(Date.now() / 1000) - syncPeriodDays * 86400 : 0

      let processedCount = 0
      for (const msg of toProcess) {
        if (cutoffTs > 0) {
          const ts = tsToUnixSeconds(msg && msg.messageTimestamp)
          if (ts > 0 && ts < cutoffTs) continue
        }
        processMessage(msg)
        processedCount++
      }
      flushConvUpdates()

      // Tracking de progresso da importação de histórico:
      // contador conta APENAS mensagens efetivamente processadas (dentro
      // do período escolhido), não o batch bruto. Quando isLatest=true,
      // encerra o import.
      try {
        const isLatest = data && data.isLatest === true
        const currentCount = instanceRecord.getInt('import_messages_count') || 0
        instanceRecord.set('import_messages_count', currentCount + processedCount)
        if (isLatest) {
          instanceRecord.set('is_importing_history', false)
          instanceRecord.set('import_finished_at', new Date().toISOString().replace('T', ' '))
          $app
            .logger()
            .info(
              'history_import_finished',
              'instance',
              instanceName,
              'total',
              currentCount + processedCount,
            )
        }
        $app.save(instanceRecord)
      } catch (progressErr) {
        $app.logger().warn('history_import_progress_error', 'error', String(progressErr))
      }
    }

    return e.json(200, { success: true })
  } catch (err) {
    $app.logger().error('Webhook error', 'error', err?.message || String(err))
    return e.json(200, { success: false, error: err?.message || String(err) })
  }
})
