routerAdd(
  'POST',
  '/backend/v1/whatsapp/sync-conversation',
  (e) => {
    // Normaliza messageTimestamp do Evolution/Baileys (number, string, Long
    // protobuf {low, high, unsigned} ou null/undefined) para Unix segundos.
    // Retorna 0 quando não dá pra interpretar.
    // (Mesma função que está em whatsapp_webhook.js — duplicada de propósito
    // para não depender de shared-scope da JSVM do PocketBase.)
    function tsToUnixSecondsSync(ts) {
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

    try {
      const body = e.requestInfo().body || {}
      const instanceName = body.instance_name
      const remoteJid = body.remote_jid
      // Paginação: se `before` (Unix segundos) for passado, retorna até 50
      // mensagens com messageTimestamp < before. Útil para "Carregar mais
      // antigas". Sem `before`, comporta-se como sync inicial (50 mais
      // recentes).
      const beforeTs = typeof body.before === 'number' && body.before > 0 ? body.before : 0

      if (!instanceName || !remoteJid) {
        return e.badRequestError('instance_name e remote_jid são obrigatórios')
      }

      const authId = e.auth.id

      // Validar ownership da instância
      let instanceRecord
      try {
        instanceRecord = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name} && user_id = {:userId}',
          { name: instanceName, userId: authId },
        )
      } catch (_) {
        return e.badRequestError('instance_not_found')
      }

      let accountId = instanceRecord.getString('account_id')
      if (!accountId) {
        try {
          const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
            userId: authId,
          })
          accountId = member.getString('account_id')
        } catch (_) {}
      }

      // Buscar/criar conversation
      let convRecord
      try {
        convRecord = $app.findFirstRecordByFilter(
          'conversations',
          'remote_jid = {:jid} && instance_name = {:name} && user_id = {:userId}',
          { jid: remoteJid, name: instanceName, userId: authId },
        )
      } catch (_) {
        const isGroup = remoteJid.endsWith('@g.us')
        const convCol = $app.findCollectionByNameOrId('conversations')
        convRecord = new Record(convCol)
        convRecord.set('user_id', authId)
        if (accountId) convRecord.set('account_id', accountId)
        convRecord.set('instance_name', instanceName)
        convRecord.set('remote_jid', remoteJid)
        convRecord.set('is_group', isGroup)
        convRecord.set('type', isGroup ? 'group' : 'individual')
        convRecord.set('unread_count', 0)
        try {
          $app.save(convRecord)
        } catch (saveErr) {
          $app
            .logger()
            .error(
              'sync_conversation_create_conv_error',
              'jid',
              remoteJid,
              'error',
              String(saveErr),
            )
          return e.json(500, { success: false, error: 'create_conversation_failed' })
        }
      }

      // Lock idempotente: 60s
      // Pular o lock quando o caller pede paginação (before > 0) — sync inicial
      // já rodou, e o user está clicando "carregar mais antigas".
      if (beforeTs === 0) {
        const lastSync = convRecord.getString('history_synced_at')
        if (lastSync) {
          const lastSyncTime = new Date(lastSync).getTime()
          if (!isNaN(lastSyncTime) && Date.now() - lastSyncTime < 60 * 1000) {
            return e.json(200, { success: true, skipped: true, reason: 'recent_sync' })
          }
        }
      }

      // Config Evolution
      const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
      const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
      const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

      if (!apiUrl || !apiKey) {
        return e.json(500, { success: false, error: 'evolution_config_missing' })
      }

      // Chamar findMessages
      let res
      try {
        res = $http.send({
          url: apiUrl + '/chat/findMessages/' + instanceName,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({ where: { key: { remoteJid: remoteJid } } }),
          timeout: 20,
        })
      } catch (httpErr) {
        $app
          .logger()
          .error('sync_conversation_evolution_error', 'jid', remoteJid, 'error', String(httpErr))
        return e.json(502, { success: false, error: 'evolution_request_failed' })
      }

      if (res.statusCode !== 200 && res.statusCode !== 201) {
        $app
          .logger()
          .error('sync_conversation_evolution_status', 'jid', remoteJid, 'status', res.statusCode)
        return e.json(502, {
          success: false,
          error: 'evolution_returned_error',
          statusCode: res.statusCode,
        })
      }

      // Extrair array de mensagens (suporta múltiplos formatos)
      let allMessages = []
      if (Array.isArray(res.json)) {
        allMessages = res.json
      } else if (res.json && Array.isArray(res.json.records)) {
        allMessages = res.json.records
      } else if (res.json && res.json.messages && Array.isArray(res.json.messages.records)) {
        allMessages = res.json.messages.records
      } else if (res.json && Array.isArray(res.json.messages)) {
        allMessages = res.json.messages
      }

      // Ordenar desc por messageTimestamp e pegar 50.
      // Quando `beforeTs > 0` (paginação), filtra primeiro por
      // `messageTimestamp < beforeTs` para pegar as 50 imediatamente
      // anteriores ao mais antigo já carregado localmente.
      let candidates = allMessages
      if (beforeTs > 0) {
        candidates = allMessages.filter((m) => {
          const ts = tsToUnixSecondsSync(m && m.messageTimestamp)
          return ts > 0 && ts < beforeTs
        })
      }
      candidates.sort((a, b) => {
        const tsA = tsToUnixSecondsSync(a && a.messageTimestamp)
        const tsB = tsToUnixSecondsSync(b && b.messageTimestamp)
        return tsB - tsA
      })
      const top50 = candidates.slice(0, 50)

      let inserted = 0
      let skipped = 0
      let oldestTimestamp = 0
      let newestTimestamp = 0
      const userId = instanceRecord.getString('user_id')
      const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')

      for (const msg of top50) {
        try {
          if (!msg || !msg.key || !msg.message) {
            skipped++
            continue
          }

          const messageId = msg.key.id
          if (!messageId) {
            skipped++
            continue
          }

          const typeKey = Object.keys(msg.message).find((k) => k !== 'messageContextInfo')
          if (!typeKey) {
            skipped++
            continue
          }

          if (
            ['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage'].includes(typeKey)
          ) {
            skipped++
            continue
          }

          const fromMe = msg.key.fromMe === true
          const participantJid = msg.key.participant || ''
          const pushName = msg.pushName || ''

          // Dedup
          try {
            $app.findFirstRecordByFilter(
              'whatsapp_messages',
              'message_id = {:msgId} && instance_name = {:name}',
              { msgId: messageId, name: instanceName },
            )
            skipped++
            continue
          } catch (_) {
            // não existe, segue
          }

          let content = ''
          let msgType = ''
          let linkPreview = null
          let isMediaPlaceholder = false

          if (typeKey === 'conversation') {
            content = msg.message.conversation || ''
            msgType = 'conversation'
          } else if (typeKey === 'extendedTextMessage') {
            const etm = msg.message.extendedTextMessage || {}
            content = etm.text || ''
            msgType = 'extendedTextMessage'
            if (etm.canonicalUrl || etm.matchedText) {
              linkPreview = {
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
            // Antes pulávamos mídia totalmente, o que fazia o "Carregar mais
            // antigas" parar de funcionar (todas as msgs de mídia viravam
            // skipped, inserted=0 → front desligava o botão).
            // Agora criamos uma mensagem PLACEHOLDER com o tipo correto e o
            // caption (se houver) como conteúdo. NÃO baixamos a mídia binary
            // — o findMessages da Evolution não retorna base64 em histórico
            // antigo, então o download falharia mesmo. UI mostra "Mídia não
            // disponível neste histórico" no balão (status='media_unavailable').
            msgType = typeKey
            const mediaData = msg.message[typeKey] || {}
            const caption = mediaData.caption || ''
            content = caption // se vazio, fica vazio — o front cai no fallback
            isMediaPlaceholder = true
          } else if (['pollCreationMessage', 'pollUpdateMessage'].includes(typeKey)) {
            msgType = typeKey
            content = '[Enquete]'
          } else {
            msgType = 'unknown'
            content = '[mensagem não suportada]'
          }

          const msgTs = tsToUnixSecondsSync(msg.messageTimestamp)
          if (msgTs > 0 && (oldestTimestamp === 0 || msgTs < oldestTimestamp)) {
            oldestTimestamp = msgTs
          }
          if (msgTs > newestTimestamp) {
            newestTimestamp = msgTs
          }

          const newMsg = new Record(msgCol)
          newMsg.set('user_id', userId)
          if (accountId) newMsg.set('account_id', accountId)
          newMsg.set('instance_name', instanceName)
          newMsg.set('remote_jid', remoteJid)
          newMsg.set('from_me', fromMe)
          newMsg.set('message_id', messageId)
          newMsg.set('push_name', pushName)
          newMsg.set('content', content)
          newMsg.set('message_type', msgType)
          // Status especial pra mídias de histórico: marca que o arquivo
          // binário não está disponível (UI já trata 'media_failed' como
          // "Mídia indisponível"; reusamos esse caminho).
          newMsg.set(
            'status',
            isMediaPlaceholder ? 'media_failed' : fromMe ? 'pending' : 'received',
          )
          newMsg.set('timestamp', msgTs || Math.floor(Date.now() / 1000))

          if (msgCol.fields.getByName('participant_jid')) {
            newMsg.set('participant_jid', participantJid)
          }
          if (msgCol.fields.getByName('participant_pushname')) {
            newMsg.set('participant_pushname', pushName)
          }

          if (linkPreview && msgCol.fields.getByName('link_url')) {
            newMsg.set('link_url', linkPreview.url)
            newMsg.set('link_title', linkPreview.title)
            newMsg.set('link_description', linkPreview.description)
            newMsg.set('link_thumbnail_b64', linkPreview.thumbnail)
          }

          $app.save(newMsg)
          inserted++
        } catch (msgErr) {
          $app
            .logger()
            .warn('sync_conversation_msg_error', 'jid', remoteJid, 'error', String(msgErr))
          skipped++
        }
      }

      // Atualizar conversation
      try {
        // Em paginação (beforeTs > 0), só atualizamos history_oldest_timestamp.
        // Nem `history_synced_at` nem `last_message_timestamp` são tocados,
        // pois paginação puxa MENSAGENS MAIS ANTIGAS — não muda a marca de
        // sync inicial nem o "topo" da conversa.
        if (beforeTs === 0) {
          convRecord.set('history_synced_at', new Date().toISOString().replace('T', ' '))
          const currentLastTs = convRecord.getInt('last_message_timestamp') || 0
          if (newestTimestamp > currentLastTs) {
            convRecord.set('last_message_timestamp', newestTimestamp)
          }
        }
        if (oldestTimestamp > 0) {
          const currentOldest = convRecord.getInt('history_oldest_timestamp') || 0
          if (currentOldest === 0 || oldestTimestamp < currentOldest) {
            convRecord.set('history_oldest_timestamp', oldestTimestamp)
          }
        }
        $app.save(convRecord)
      } catch (updErr) {
        $app
          .logger()
          .warn('sync_conversation_update_conv_error', 'jid', remoteJid, 'error', String(updErr))
      }

      $app
        .logger()
        .info(
          'sync_conversation_done',
          'jid',
          remoteJid,
          'inserted',
          inserted,
          'skipped',
          skipped,
          'total',
          allMessages.length,
        )

      // has_more: se conseguimos preencher 50 candidatos anteriores ao
      // beforeTs, é provável que tenha mais. Se top50 < 50, esgotou o que
      // a Evolution tinha em cache para o filtro pedido.
      // Usado pelo front pra decidir mostrar/esconder o botão "Carregar
      // mais antigas". Antes o front desligava o botão quando inserted===0,
      // o que confundia "todas as 50 já existiam (dedup)" com "esgotou".
      const hasMore = top50.length === 50

      return e.json(200, {
        success: true,
        inserted: inserted,
        skipped: skipped,
        total_returned: allMessages.length,
        has_more: hasMore,
      })
    } catch (err) {
      $app.logger().error('sync_conversation_fatal', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
