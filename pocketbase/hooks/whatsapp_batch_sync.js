// IMPORT EM LOTE DO BURACO DE MENSAGENS (leitura, zero deletes, zero envio)
// Quando a instância fica sem webhook (ou o webhook falha) por um período,
// as mensagens recebidas nessa janela não chegam ao inbox — o webhook só
// entrega mensagens NOVAS a partir do momento em que é reconfigurado.
// Este cron fecha o buraco: para cada conversa ativa nas últimas 24h da
// instância connected, chama a MESMA leitura já usada pelo sync por conversa
// (chat/findMessages da Evolution API, chamada de LEITURA — a mesma do
// whatsapp_sync_conversation.js) e importa apenas mensagens posteriores ao
// início do buraco (ts 1794874200 = 00h10 de 17/11, horário de Brasília).
// Idempotente: dedup por message_id + instance_name, igual ao
// sync-conversation. Nada é apagado; nenhuma mensagem é enviada; a Evolution
// API é tocada apenas em leitura.
//
// Roda a cada 2h no minuto 21 (minuto escalonado, não colide com outros
// crons; respeita Night Shield 21h-07h e as otimizações vigentes — mínimo
// de 30min entre sincronias). ISENTO do kill-switch global (leitura pura).
cronAdd('whatsapp_batch_sync', '21 */2 * * *', () => {
  try {
    var cronStartMs = Date.now()

    // IMPORTANTE (escopo da JSVM do PocketBase): callbacks rodam em pool
    // separado — declarações top-level (function/var) do arquivo NÃO são
    // visíveis dentro do callback em runtime (ReferenceError). Por isso,
    // TODA lógica auxiliar (previewFor, tsToUnix) vive INLINE no corpo
    // deste callback, nunca no escopo top-level do arquivo.
    //
    // Preview curto do last_message para tipos de mídia (mesmo padrão do
    // sync-conversation e do webhook).
    function previewFor(msgType, content) {
      if (content && content.trim()) return content
      if (!msgType) return ''
      if (msgType.indexOf('image') >= 0) return '[Imagem]'
      if (msgType.indexOf('audio') >= 0) return '[Áudio]'
      if (msgType.indexOf('video') >= 0) return '[Vídeo]'
      if (msgType.indexOf('document') >= 0) return '[Documento]'
      if (msgType.indexOf('sticker') >= 0) return '[Sticker]'
      return ''
    }

    // Normaliza messageTimestamp do Evolution/Baileys (number, string, Long
    // protobuf {low, high, unsigned} ou null) para Unix segundos — mesma
    // função de whatsapp_sync_conversation.js/whatsapp_webhook.js, duplicada
    // de propósito para não depender de shared-scope da JSVM.
    function tsToUnix(ts) {
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

    // ISENTO do kill-switch global (global_automations_paused): o import é
    // somente leitura (chat/findMessages da Evolution) + INSERT dedup por
    // message_id no banco local. NUNCA envia mensagem, NUNCA apaga, NUNCA
    // toca na instância. O kill-switch existe para impedir ENVIO/PUSH —
    // bloquear o espelhamento de leitura deixaria o inbox cego.
    //
    // Night Shield (21h-07h, horário de Brasília): importação pesada não roda.
    var hSp = new Date(cronStartMs - 3 * 3600 * 1000).getUTCHours()
    if (hSp >= 21 || hSp < 7) return

    // Instância REAL connected: única que importa.
    var instances = []
    try {
      instances = $app.findRecordsByFilter(
        'whatsapp_instances',
        "status = 'connected' && is_importing_history = false",
        '-created',
        2,
        0,
      )
    } catch (err) {
      $app.logger().error('whatsapp_batch_sync_query_error', 'error', String(err))
      return
    }
    if (!instances || instances.length === 0) return

    // Início do buraco a fechar (Unix segundos): 05h48 de 18/11 (Brasília).
    // Mensagens posteriores que chegaram pelo webhook são dedupicadas, então
    // cobrir "desde 05h48" é seguro e idempotente.
    var sinceTs = 1794972480

    var urlStr = $secrets.get('EVOLUTION_API_URL') || ''
    var apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    var apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
    if (!apiUrl || !apiKey) return

    var totalInserted = 0
    var totalSkipped = 0
    var convsProcessed = 0

    for (var i = 0; i < instances.length; i++) {
      if (convsProcessed >= 30) break
      var instRec = instances[i]
      var instanceName = instRec.getString('instance_name')
      var accountId = instRec.getString('account_id')
      var instUserId = instRec.getString('user_id')

      // Conversas ativas nas últimas 24h (não-grupo), mais recente primeiro.
      var cutoffSec = Math.floor((cronStartMs - 24 * 3600 * 1000) / 1000)
      var convs = []
      try {
        convs = $app.findRecordsByFilter(
          'conversations',
          'instance_name = {:inst} && is_group = false && last_message_timestamp > {:cutoff}',
          '-last_message_timestamp',
          30,
          0,
          { inst: instanceName, cutoff: cutoffSec },
        )
      } catch (cErr) {
        $app.logger().warn('whatsapp_batch_sync_convs_error', 'error', String(cErr))
        continue
      }
      if (convs.length === 0) continue

      for (var j = 0; j < convs.length; j++) {
        if (Date.now() - cronStartMs > 55 * 1000) break
        var conv = convs[j]
        var remoteJid = conv.getString('remote_jid')
        if (!remoteJid) continue
        convsProcessed++

        try {
          var res = $http.send({
            url: apiUrl + '/chat/findMessages/' + encodeURIComponent(instanceName),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify({ where: { key: { remoteJid: remoteJid } } }),
            timeout: 6,
          })
          if (res.statusCode !== 200 && res.statusCode !== 201) {
            $app
              .logger()
              .warn('whatsapp_batch_sync_http', 'jid', remoteJid, 'status', res.statusCode)
            continue
          }

          var all = []
          if (Array.isArray(res.json)) all = res.json
          else if (res.json && Array.isArray(res.json.records)) all = res.json.records
          else if (res.json && res.json.messages && Array.isArray(res.json.messages.records))
            all = res.json.messages.records
          else if (res.json && Array.isArray(res.json.messages)) all = res.json.messages

          var inserted = 0
          var skipped = 0
          var newestTs = 0
          var newestFromMe = false
          var newestPreview = ''
          var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')

          for (var k = 0; k < all.length; k++) {
            var msg = all[k]
            if (!msg || !msg.key || !msg.message) continue
            var ts = tsToUnix(msg.messageTimestamp)
            if (ts <= sinceTs) continue

            var messageId = msg.key.id
            if (!messageId) continue

            // Dedup por message_id + instance (idêntico ao sync-conversation)
            try {
              $app.findFirstRecordByFilter(
                'whatsapp_messages',
                'message_id = {:mid} && instance_name = {:inst}',
                { mid: messageId, inst: instanceName },
              )
              skipped++
              continue
            } catch (_) {}

            var typeKey = Object.keys(msg.message).find(
              (kt) => kt !== 'messageContextInfo' && kt !== 'base64',
            )
            if (!typeKey) continue
            if (
              ['protocolMessage', 'senderKeyDistributionMessage', 'secretEncryptedMessage'].indexOf(
                typeKey,
              ) >= 0
            )
              continue

            var fromMe = msg.key.fromMe === true
            var participantJid = msg.key.participant || ''
            var pushName = msg.pushName || ''
            var content = ''
            var msgType = ''
            var isMedia = false

            if (typeKey === 'conversation') {
              content = msg.message.conversation || ''
              msgType = 'conversation'
            } else if (typeKey === 'extendedTextMessage') {
              var etm = msg.message.extendedTextMessage || {}
              content = etm.text || ''
              msgType = 'extendedTextMessage'
            } else if (
              [
                'imageMessage',
                'videoMessage',
                'audioMessage',
                'documentMessage',
                'stickerMessage',
              ].indexOf(typeKey) >= 0
            ) {
              msgType = typeKey
              var mediaData = msg.message[typeKey] || {}
              content = mediaData.caption || ''
              isMedia = true
            } else if (typeKey === 'pollCreationMessage' || typeKey === 'pollUpdateMessage') {
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
              content = '[Contato compartilhado]'
            } else if (typeKey === 'ephemeralMessage') {
              msgType = 'ephemeralMessage'
              content = '[Mensagem temporária]'
            } else {
              msgType = typeKey || 'unknown'
              content = '[Mensagem não suportada]'
            }

            if (ts > newestTs) {
              newestTs = ts
              newestFromMe = fromMe
              newestPreview = previewFor(msgType, content)
            }

            try {
              var newMsg = new Record(msgCol)
              newMsg.set('user_id', instUserId)
              if (accountId) newMsg.set('account_id', accountId)
              newMsg.set('instance_name', instanceName)
              newMsg.set('remote_jid', remoteJid)
              newMsg.set('from_me', fromMe)
              newMsg.set('message_id', messageId)
              newMsg.set('push_name', fromMe ? '' : pushName)
              newMsg.set('content', content)
              newMsg.set('message_type', msgType)
              // Mídia sem base64 no histórico: placeholder (mesmo caminho do
              // sync-conversation — UI mostra "mídia não disponível").
              newMsg.set('status', isMedia ? 'media_failed' : fromMe ? 'pending' : 'received')
              newMsg.set('timestamp', ts || Math.floor(Date.now() / 1000))
              try {
                if (msgCol.fields.getByName('participant_jid'))
                  newMsg.set('participant_jid', participantJid)
              } catch (_) {}
              try {
                if (msgCol.fields.getByName('participant_pushname'))
                  newMsg.set('participant_pushname', pushName)
              } catch (_) {}
              $app.save(newMsg)
              inserted++
            } catch (saveErr) {
              skipped++
            }
          }

          // Atualizar conversation (last_message / last_message_timestamp)
          if (newestTs > 0) {
            try {
              var convFresh = $app.findRecordById('conversations', conv.id)
              var curLast = convFresh.getInt('last_message_timestamp') || 0
              if (newestTs > curLast) {
                convFresh.set('last_message_timestamp', newestTs)
                if (newestPreview) convFresh.set('last_message', newestPreview)
                // Mensagem perdida era do contato: sinaliza no badge de não lidas.
                if (!newestFromMe) {
                  try {
                    convFresh.set('unread_count', (convFresh.getInt('unread_count') || 0) + 1)
                  } catch (_) {}
                }
                $app.save(convFresh)
              }
            } catch (_) {}
          }

          totalInserted += inserted
          totalSkipped += skipped
          if (inserted > 0) {
            $app
              .logger()
              .info(
                'whatsapp_batch_sync_conv',
                'jid',
                remoteJid,
                'inserted',
                inserted,
                'skipped',
                skipped,
              )
          }
        } catch (loopErr) {
          $app
            .logger()
            .warn('whatsapp_batch_sync_conv_error', 'jid', remoteJid, 'error', String(loopErr))
        }
      }
    }

    $app
      .logger()
      .info(
        'whatsapp_batch_sync_done',
        'inserted',
        totalInserted,
        'skipped',
        totalSkipped,
        'convs',
        convsProcessed,
      )
  } catch (fatalErr) {
    $app.logger().error('whatsapp_batch_sync_fatal', 'error', String(fatalErr))
  }
})
