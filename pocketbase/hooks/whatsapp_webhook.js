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
            // contact_name: primeiro pushName não vazio em conv individual (apenas se NÃO for fromMe e NÃO for nome inválido/da clínica)
            if (!agg.isGroup && m.pushName && !m.fromMe && !isInvalidOrClinicPushName(m.pushName)) {
              const currentName = convRecord.getString('contact_name') || ''
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

    // Helper para detectar nomes inválidos, genéricos ou pertencentes à própria clínica
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
          const cName = crmRec.getString('contact_name') || ''
          const pName = crmRec.getString('push_name') || ''
          let crmDirty = false
          if (!cName || isInvalidOrClinicPushName(cName)) {
            crmRec.set('contact_name', newName)
            crmDirty = true
          }
          if (!pName || isInvalidOrClinicPushName(pName)) {
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
