// REPARO AUTOMÁTICO DA SESSÃO REAL DO WHATSAPP (a cada 2min)
// Cenário: o número real do Dr. Caio vive numa instância da Evolution API
// que pode NÃO existir no banco local (ex.: instance_1786021758855), enquanto
// registros órfãos no banco ficam 'connected' sem webhook real. Resultado:
// nenhuma mensagem nova espelhada. Este cron:
//   1. Consulta /instance/fetchInstances (leitura) e acha a instância REALMENTE
//      connected (connectionStatus 'open'/'connected').
//   2. Se o banco não reflete isso (registro faltando, status errado ou
//      webhook na Evolution apontando para outra URL): grava o webhook na
//      instância real (POST /webhook/set — mesma payload dos hooks existentes),
//      cria/atualiza o registro local (real = connected, phone_number da
//      Evolution) e marca TODAS as outras como disconnected. ZERO deletes.
//   3. ConnectionState real: GET /instance/connectionState/{name}. Se o estado
//      divergir de "open" (socket zumbi: banco/Evolution dizem connected mas a
//      sessão não entrega eventos), OU se 3 ciclos de reparo (2min cada)
//      passarem sem nenhum evento chegar (webhook_reconfigured_streak vs.
//      heartbeat last_webhook_event_at): POST /instance/restart/{name} —
//      no máximo 1 restart a cada 30min (cooldown anti-tempestade).
//      RESTART apenas, NUNCA logout, NUNCA delete (restart não despareia o
//      celular). Depois do restart o contador zera. Night Shield 21h-07h:
//      restart NÃO roda de madrugada (só task/alerta via monitor de silêncio).
//   4. Import de mensagens presas (leitura via /chat/findMessages, dedupe por
//      message_id + instance_name) desde a MEIA-NOITE de hoje (São Paulo) nas
//      últimas 48h da instância real. Só INSERT/UPDATE no banco, nunca envia.
// NUNCA envia mensagem, NUNCA apaga, NUNCA faz logout na Evolution.
// ISENTO do kill-switch global (não envia nada — kill-switch existe p/ envio).
// Fora do Night Shield o restart é permitido (reparo de sessão, sem envio).
cronAdd('whatsapp_real_session_repair', '*/2 * * * *', () => {
  try {
    var cronStartMs = Date.now()

    // ---------- helpers inline (escopo JSVM: nada no top-level) ----------
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

    // ---------- config ----------
    var urlStr = ($secrets.get('EVOLUTION_API_URL') || '').trim()
    var apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    var apiKey = ($secrets.get('EVOLUTION_API_KEY') || '').trim()
    if (!apiUrl || !apiKey) return

    // Mesma ordem de resolução do whatsapp_webhook.js (PB_WEBHOOK_URL primeiro).
    var webhookUrl = ($secrets.get('PB_WEBHOOK_URL') || '').trim()
    if (!webhookUrl) {
      var instanceUrl = ($secrets.get('PB_INSTANCE_URL') || '').trim()
      if (instanceUrl) {
        webhookUrl = instanceUrl.replace(/\/$/, '') + '/backend/v1/whatsapp/webhook'
      }
    }
    if (!webhookUrl) {
      var pbUrl = ($secrets.get('POCKETBASE_URL') || '').trim()
      if (pbUrl) {
        webhookUrl = pbUrl.replace(/\/$/, '') + '/backend/v1/whatsapp/webhook'
      }
    }
    if (!webhookUrl) return

    // ---------- 1. Instância real connected na Evolution ----------
    var evoInstances = []
    try {
      var resList = $http.send({
        url: apiUrl + '/instance/fetchInstances',
        method: 'GET',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        timeout: 8,
      })
      if (resList.statusCode >= 200 && resList.statusCode < 300 && Array.isArray(resList.json)) {
        evoInstances = resList.json
      } else {
        $app.logger().warn('real_session_repair_fetch_status', 'status', resList.statusCode)
        return
      }
    } catch (err) {
      $app.logger().warn('real_session_repair_fetch_error', 'error', String(err))
      return
    }

    var realName = ''
    var realOwnerJid = ''
    var realProfileName = ''
    for (var i = 0; i < evoInstances.length; i++) {
      var inst = evoInstances[i] || {}
      var name = inst.name || inst.instanceName || inst.instance || ''
      var connStatus = ''
      if (inst.connectionStatus) connStatus = inst.connectionStatus
      else if (inst.instance && inst.instance.connectionStatus)
        connStatus = inst.instance.connectionStatus
      else if (inst.state) connStatus = inst.state
      if (name && (connStatus === 'open' || connStatus === 'connected')) {
        realName = name
        if (inst.ownerJid) realOwnerJid = inst.ownerJid
        else if (inst.instance && inst.instance.ownerJid) realOwnerJid = inst.instance.ownerJid
        if (inst.profileName) realProfileName = inst.profileName
        else if (inst.instance && inst.instance.profileName)
          realProfileName = inst.instance.profileName
        break
      }
    }
    if (!realName) {
      // Nenhuma instância connected na Evolution: nada a reparar (não criar
      // instância, não marcar connected no banco — evitar órfãs).
      return
    }

    var realPhone = String(realOwnerJid).split('@')[0].replace(/\D/g, '')

    // ---------- 1b. ConnectionState REAL da instância ----------
    // fetchInstances pode trazer status em cache; o estado de verdade da
    // sessão vem de /instance/connectionState/{name}.
    var realConnState = ''
    try {
      var resConn = $http.send({
        url: apiUrl + '/instance/connectionState/' + encodeURIComponent(realName),
        method: 'GET',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        timeout: 6,
      })
      if (resConn.json) {
        var stObj = resConn.json
        if (stObj.instance && stObj.instance.state) realConnState = stObj.instance.state
        else if (stObj.state) realConnState = stObj.state
        else if (typeof stObj.connectionStatus === 'string') realConnState = stObj.connectionStatus
      }
    } catch (connErr) {
      $app.logger().warn('real_session_repair_connstate_err', 'error', String(connErr))
    }
    var stateDiverged = realConnState !== '' && realConnState !== 'open'

    // Night Shield 21h-07h (horário de Brasília): restart só de dia.
    var hSp = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
    var nightShield = hSp >= 21 || hSp < 7

    // ---------- 2. Estado local vs. Evolution ----------
    var needRepair = false
    var localRealRec = null
    var localRecords = []
    try {
      localRecords = $app.findRecordsByFilter('whatsapp_instances', '', '', 200, 0)
    } catch (err) {
      $app.logger().warn('real_session_repair_db_read', 'error', String(err))
      return
    }
    for (var r = 0; r < localRecords.length; r++) {
      var rec = localRecords[r]
      var rName = rec.getString('instance_name')
      if (rName === realName) {
        localRealRec = rec
        if (rec.getString('status') !== 'connected') needRepair = true
        if (realPhone && rec.getString('phone_number') !== realPhone) needRepair = true
      } else if (rec.getString('status') === 'connected') {
        // Outro registro marcado connected que não é a real → precisa corrigir.
        needRepair = true
      }
    }
    if (!localRealRec) needRepair = true

    // ---------- 2b. Heartbeat + streak de regravações sem evento ----------
    var heartbeatTs = 0
    try {
      var heRaw = localRealRec ? localRealRec.getString('last_webhook_event_at') || '' : ''
      if (heRaw) {
        var heMs = Date.parse(heRaw.replace(' ', 'T') + (heRaw.indexOf('Z') >= 0 ? '' : 'Z'))
        if (isFinite(heMs)) heartbeatTs = Math.floor(heMs / 1000)
      }
    } catch (_) {}
    var currentStreak = 0
    try {
      if (localRealRec) currentStreak = localRealRec.getInt('webhook_reconfigured_streak') || 0
    } catch (_) {}
    var nowSecs2 = Math.floor(cronStartMs / 1000)
    var heartbeatFresh = heartbeatTs > 0 && nowSecs2 - heartbeatTs < 15 * 60
    // Streak = ciclos de reparo (2min) sem NENHUM evento do webhook chegar.
    // Incrementa a cada ciclo em silêncio, MESMO quando a URL do webhook já
    // está correta na Evolution (zumbi: regravar não muda nada, mas o restart
    // precisa acontecer do mesmo jeito).
    var streakAfterSet = heartbeatFresh ? 0 : currentStreak + 1

    // Confere o webhook na instância real ANTES de gravar (evita regravar
    // sem necessidade — só grava se a URL divergir da alvo).
    var webhookOk = false
    try {
      var resFind = $http.send({
        url: apiUrl + '/webhook/find/' + realName,
        method: 'GET',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        timeout: 6,
      })
      if (resFind.json) {
        var curUrl = resFind.json.url || (resFind.json.webhook && resFind.json.webhook.url) || ''
        webhookOk = curUrl === webhookUrl
      }
    } catch (whErr) {
      $app.logger().warn('real_session_repair_webhook_find', 'error', String(whErr))
    }

    if (!webhookOk) needRepair = true

    // ---------- 3. Gravar webhook na instância real ----------
    var webhookWasSet = false
    if (!webhookOk) {
      try {
        var resSet = $http.send({
          url: apiUrl + '/webhook/set/' + realName,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          // Payload CANÔNICO (flat, igual ao whatsapp_webhook.js): sem aninhar
          // sob "webhook" — a Evolution espera enabled/url/events na raiz.
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
        webhookWasSet = true
        $app
          .logger()
          .info(
            'real_session_repair_webhook_set',
            'instance',
            realName,
            'status',
            resSet.statusCode,
            'streak',
            streakAfterSet,
          )
      } catch (setErr) {
        $app.logger().warn('real_session_repair_webhook_set_err', 'error', String(setErr))
        return
      }
    }

    // ---------- 4. Banco: real=connected, resto disconnected (zero deletes) ----------
    var nowIso = new Date().toISOString().replace('T', ' ')
    var realRecordId = localRealRec ? localRealRec.id : ''
    var accountId = ''
    var userId = ''
    try {
      for (var r2 = 0; r2 < localRecords.length; r2++) {
        var rec2 = localRecords[r2]
        var rName2 = rec2.getString('instance_name')
        var newStatus = rName2 === realName ? 'connected' : 'disconnected'
        var changed = rec2.getString('status') !== newStatus
        try {
          if (changed) rec2.set('status', newStatus)
          if (rName2 === realName) {
            if (realPhone && rec2.getString('phone_number') !== realPhone)
              rec2.set('phone_number', realPhone)
            rec2.set('last_webhook_reconfigured_at', nowIso)
            // Contador de regravações sem evento: zera se o heartbeat está
            // fresco (eventos chegando), soma 1 a cada regravação em silêncio.
            rec2.set('webhook_reconfigured_streak', streakAfterSet)
          }
          if (changed || rName2 === realName) {
            $app.saveNoValidate(rec2)
            if (!accountId && rec2.getString('account_id')) accountId = rec2.getString('account_id')
            if (!userId && rec2.getString('user_id')) userId = rec2.getString('user_id')
          }
        } catch (upErr) {
          $app
            .logger()
            .warn('real_session_repair_db_update', 'inst', rName2, 'error', String(upErr))
        }
      }

      // Registro local faltando para a instância real: criar (nunca apagar).
      if (!localRealRec) {
        try {
          var colInst = $app.findCollectionByNameOrId('whatsapp_instances')
          var newRec = new Record(colInst)
          newRec.set('instance_name', realName)
          newRec.set('status', 'connected')
          if (realPhone) newRec.set('phone_number', realPhone)
          newRec.set('last_webhook_reconfigured_at', nowIso)
          // account/user: herda do registro 'connected' órfão mais recente
          // (mesma conta — o número é o mesmo, o que faltava era o registro).
          for (var r3 = 0; r3 < localRecords.length; r3++) {
            var cand = localRecords[r3]
            if (cand.getString('account_id') && cand.getString('user_id')) {
              accountId = cand.getString('account_id')
              userId = cand.getString('user_id')
              break
            }
          }
          if (userId) newRec.set('user_id', userId)
          if (accountId) newRec.set('account_id', accountId)
          $app.saveNoValidate(newRec)
          $app.logger().info('real_session_repair_created', 'instance', realName)
        } catch (createErr) {
          $app.logger().warn('real_session_repair_create_err', 'error', String(createErr))
          return
        }
      }
    } catch (dbErr) {
      $app.logger().warn('real_session_repair_db_err', 'error', String(dbErr))
      return
    }

    // ---------- 4b. RESTART da instância (socket zumbi) ----------
    // Dispara se o connectionState real divergiu de "open" OU se 3 ciclos de
    // reparo (2min cada) passarem sem NENHUM evento chegar. Restart NUNCA
    // despareia o celular; logout/delete são proibidos (decisão Dr. Caio).
    var streakNow = heartbeatFresh ? 0 : currentStreak + 1
    // Cooldown: no máximo 1 restart a cada 30min (evita tempestade durante
    // silêncio total; com streak por ciclo, o 1º restart sai em ~6min).
    var lastRestartMs = 0
    try {
      var lrRaw = localRealRec ? localRealRec.getString('last_instance_restart_at') || '' : ''
      if (lrRaw) {
        var lrParsed = Date.parse(lrRaw.replace(' ', 'T') + (lrRaw.indexOf('Z') >= 0 ? '' : 'Z'))
        if (isFinite(lrParsed)) lastRestartMs = lrParsed
      }
    } catch (_) {}
    var restartCooldownOk = cronStartMs - lastRestartMs >= 30 * 60 * 1000
    var restartNeeded = (stateDiverged || streakNow >= 3) && restartCooldownOk
    if (restartNeeded) {
      if (nightShield) {
        $app
          .logger()
          .warn(
            'real_session_repair_restart_deferred',
            'instance',
            realName,
            'conn_state',
            realConnState,
            'streak',
            streakNow,
            'reason',
            'night_shield',
          )
      } else {
        try {
          var resRestart = $http.send({
            url: apiUrl + '/instance/restart/' + encodeURIComponent(realName),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apiKey },
            body: JSON.stringify({}),
            timeout: 15,
          })
          $app
            .logger()
            .info(
              'real_session_repair_restart',
              'instance',
              realName,
              'status',
              resRestart.statusCode,
              'conn_state_before',
              realConnState,
              'streak_before',
              streakNow,
            )
          try {
            var recRestart = $app.findRecordById('whatsapp_instances', realRecordId)
            recRestart.set('last_instance_restart_at', nowIso)
            recRestart.set('webhook_reconfigured_streak', 0)
            $app.saveNoValidate(recRestart)
          } catch (_) {}
        } catch (restartErr) {
          $app
            .logger()
            .warn(
              'real_session_repair_restart_err',
              'instance',
              realName,
              'error',
              String(restartErr),
            )
        }
      }
    }

    // ---------- 5. Import das mensagens presas (leitura, dedupe) ----------
    // Janela: meia-noite de hoje (São Paulo = UTC-3) até 48h atrás, o que for
    // mais recente. Idempotente: dedupe por message_id + instance_name.
    var midnightSp = Math.floor((cronStartMs - (cronStartMs % 86400000) - 3 * 3600 * 1000) / 1000)
    var fortyEightHAgo = Math.floor((cronStartMs - 48 * 3600 * 1000) / 1000)
    var sinceTs = midnightSp > fortyEightHAgo ? midnightSp : fortyEightHAgo

    // Conversas ativas da conta nas últimas 48h (qualquer instance_name — o
    // registro antigo pode estar numa instância legada).
    var convs = []
    try {
      var convFilter = 'is_group = false && last_message_timestamp > {:cutoff}'
      var convParams = { cutoff: sinceTs }
      if (accountId) {
        convFilter = 'account_id = {:acc} && is_group = false && last_message_timestamp > {:cutoff}'
        convParams = { acc: accountId, cutoff: sinceTs }
      }
      convs = $app.findRecordsByFilter(
        'conversations',
        convFilter,
        '-last_message_timestamp',
        50,
        0,
        convParams,
      )
    } catch (cErr) {
      $app.logger().warn('real_session_repair_convs_error', 'error', String(cErr))
      return
    }

    var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
    var convColUpd = $app.findCollectionByNameOrId('conversations')
    var totalInserted = 0

    for (var j = 0; j < convs.length; j++) {
      if (Date.now() - cronStartMs > 55 * 1000) break
      var conv = convs[j]
      var remoteJid = conv.getString('remote_jid')
      if (!remoteJid) continue

      try {
        var resMsg = $http.send({
          url: apiUrl + '/chat/findMessages/' + encodeURIComponent(realName),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({ where: { key: { remoteJid: remoteJid } } }),
          timeout: 8,
        })
        if (resMsg.statusCode !== 200 && resMsg.statusCode !== 201) continue

        var all = []
        if (Array.isArray(resMsg.json)) all = resMsg.json
        else if (resMsg.json && Array.isArray(resMsg.json.records)) all = resMsg.json.records
        else if (resMsg.json && resMsg.json.messages && Array.isArray(resMsg.json.messages.records))
          all = resMsg.json.messages.records
        else if (resMsg.json && Array.isArray(resMsg.json.messages)) all = resMsg.json.messages

        var newestTs = 0
        var newestFromMe = false
        var newestPreview = ''

        for (var k = 0; k < all.length; k++) {
          var msg = all[k]
          if (!msg || !msg.key || !msg.message) continue
          var ts = tsToUnix(msg.messageTimestamp)
          if (ts <= sinceTs) continue
          var messageId = msg.key.id
          if (!messageId) continue

          // Dedupe por message_id + instance_name (a instância real).
          try {
            $app.findFirstRecordByFilter(
              'whatsapp_messages',
              'message_id = {:mid} && instance_name = {:inst}',
              { mid: messageId, inst: realName },
            )
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
            newMsg.set('user_id', userId)
            if (accountId) newMsg.set('account_id', accountId)
            newMsg.set('instance_name', realName)
            newMsg.set('remote_jid', remoteJid)
            newMsg.set('from_me', fromMe)
            newMsg.set('message_id', messageId)
            newMsg.set('push_name', fromMe ? '' : pushName)
            newMsg.set('content', content)
            newMsg.set('message_type', msgType)
            newMsg.set('status', isMedia ? 'media_failed' : fromMe ? 'pending' : 'received')
            newMsg.set('timestamp', ts || Math.floor(Date.now() / 1000))
            try {
              if (msgCol.fields.getByName('participant_jid'))
                newMsg.set('participant_jid', msg.key.participant || '')
            } catch (_) {}
            try {
              if (msgCol.fields.getByName('participant_pushname'))
                newMsg.set('participant_pushname', pushName)
            } catch (_) {}
            $app.saveNoValidate(newMsg)
            totalInserted++
          } catch (saveErr) {}
        }

        // Atualiza a conversa para a instância real + last_message.
        if (newestTs > 0) {
          try {
            var convFresh = $app.findRecordById('conversations', conv.id)
            var curLast = convFresh.getInt('last_message_timestamp') || 0
            if (newestTs > curLast) {
              convFresh.set('last_message_timestamp', newestTs)
              if (newestPreview) convFresh.set('last_message', newestPreview)
              if (convFresh.getString('instance_name') !== realName)
                convFresh.set('instance_name', realName)
              if (!newestFromMe) {
                try {
                  convFresh.set('unread_count', (convFresh.getInt('unread_count') || 0) + 1)
                } catch (_) {}
              }
              $app.saveNoValidate(convFresh)
            } else if (convFresh.getString('instance_name') !== realName) {
              convFresh.set('instance_name', realName)
              $app.saveNoValidate(convFresh)
            }
          } catch (_) {}
        }
      } catch (loopErr) {
        $app
          .logger()
          .warn('real_session_repair_conv_error', 'jid', remoteJid, 'error', String(loopErr))
      }
    }

    if (totalInserted > 0) {
      $app
        .logger()
        .info('real_session_repair_import', 'instance', realName, 'inserted', totalInserted)
    }
  } catch (fatalErr) {
    $app.logger().error('real_session_repair_fatal', 'error', String(fatalErr))
  }
})
