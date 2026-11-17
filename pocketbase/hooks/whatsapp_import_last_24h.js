// IMPORT DAS ÚLTIMAS 24H DA INSTÂNCIA REAL — rota de disparo manual.
// Complementa o cron whatsapp_batch_sync (que roda a cada 2h): esta rota
// executa o MESMO import (leitura pura, dedupe por message_id, zero deletes,
// zero envio) imediatamente para a instância que a Evolution reporta como
// connected. Toda lógica vive inline no callback (escopo da JSVM).
routerAdd(
  'POST',
  '/backend/v1/whatsapp/import-last-24h',
  (e) => {
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

    function isInvalidName(val) {
      if (!val) return true
      const t = String(val).trim()
      if (!t) return true
      if (t.indexOf('@') !== -1) return true
      if (!/[a-zA-Z\u00C0-\u017F]/.test(t)) return true
      return false
    }

    const body = e.requestInfo().body || {}
    const authId = e.auth ? e.auth.id : ''
    const result = {
      instance: null,
      conversations: [],
      totalInserted: 0,
      totalSkipped: 0,
      errors: [],
    }

    const urlStr = ($secrets.get('EVOLUTION_API_URL') || '').trim()
    const apiKey = ($secrets.get('EVOLUTION_API_KEY') || '').trim()
    if (!urlStr || !apiKey) {
      return e.json(500, { success: false, error: 'evolution_config_missing' })
    }
    const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    const headers = { 'Content-Type': 'application/json', apikey: apiKey }

    // Instância real: a que a Evolution reporta como connected (fetchInstances).
    let realInstance = ''
    let ownerDigits = ''
    try {
      const res = $http.send({
        url: apiUrl + '/instance/fetchInstances',
        method: 'GET',
        headers: { apikey: apiKey },
        timeout: 10,
      })
      if (res.statusCode >= 200 && res.statusCode < 300 && Array.isArray(res.json)) {
        for (let i = 0; i < res.json.length; i++) {
          const inst = res.json[i] || {}
          const name = inst.name || inst.instanceName || ''
          let st = inst.connectionStatus || (inst.instance && inst.instance.connectionStatus) || ''
          if (st === 'open' || st === 'connected') {
            realInstance = name
            const owner = inst.ownerJid || (inst.instance && inst.instance.ownerJid) || ''
            ownerDigits = String(owner).split('@')[0].replace(/\D/g, '')
            break
          }
        }
      }
    } catch (err) {
      result.errors.push('fetchInstances error: ' + String(err))
      return e.json(502, { success: false, result })
    }
    if (!realInstance) {
      result.errors.push('nenhuma instância connected na Evolution')
      return e.json(200, { success: false, result })
    }
    result.instance = realInstance

    // Registro local da instância (pode não existir — instância órfã)
    let instRec = null
    let userId = ''
    let accountId = ''
    try {
      instRec = $app.findFirstRecordByFilter('whatsapp_instances', 'instance_name = {:n}', {
        n: realInstance,
      })
      userId = instRec.getString('user_id')
      accountId = instRec.getString('account_id')
    } catch (_) {}
    if (!userId && authId) userId = authId
    if (!accountId && authId) {
      try {
        const m = $app.findFirstRecordByFilter('account_members', 'user_id = {:u}', { u: authId })
        if (m) accountId = m.getString('account_id')
      } catch (_) {}
    }

    // Janela: últimas 24h. Dedupe por message_id torna o import idempotente.
    let sinceTs = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000)
    if (body.since && typeof body.since === 'number' && body.since > 0) {
      sinceTs = body.since
    }

    // Conversas ativas na janela (não-grupo)
    let convs = []
    try {
      convs = $app.findRecordsByFilter(
        'conversations',
        'is_group = false && last_message_timestamp > {:cutoff}',
        '-last_message_timestamp',
        60,
        0,
        { cutoff: sinceTs },
      )
    } catch (err) {
      result.errors.push('conversations query error: ' + String(err))
      return e.json(200, { success: false, result })
    }

    const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')

    for (let ci = 0; ci < convs.length; ci++) {
      const conv = convs[ci]
      const remoteJid = conv.getString('remote_jid')
      if (!remoteJid) continue

      let messages = []
      try {
        const res = $http.send({
          url: apiUrl + '/chat/findMessages/' + realInstance,
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ where: { key: { remoteJid: remoteJid } } }),
          timeout: 20,
        })
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (Array.isArray(res.json)) messages = res.json
          else if (res.json && Array.isArray(res.json.records)) messages = res.json.records
          else if (res.json && res.json.messages && Array.isArray(res.json.messages.records))
            messages = res.json.messages.records
          else if (res.json && Array.isArray(res.json.messages)) messages = res.json.messages
        }
      } catch (err) {
        result.errors.push('findMessages ' + remoteJid + ': ' + String(err))
        continue
      }

      let convInserted = 0
      let newestTs = 0
      for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi]
        if (!msg || !msg.key || !msg.message) continue
        const messageId = msg.key.id
        if (!messageId) continue
        const msgTs = tsToUnix(msg.messageTimestamp)
        if (msgTs <= sinceTs) continue // fora da janela

        const typeKey = Object.keys(msg.message).find((k) => k !== 'messageContextInfo')
        if (!typeKey) continue
        if (
          [
            'protocolMessage',
            'senderKeyDistributionMessage',
            'secretEncryptedMessage',
            'reactionMessage',
          ].indexOf(typeKey) !== -1
        )
          continue

        // Dedupe: message_id + instance_name
        try {
          $app.findFirstRecordByFilter(
            'whatsapp_messages',
            'message_id = {:mid} && instance_name = {:iname}',
            { mid: messageId, iname: realInstance },
          )
          continue
        } catch (_) {}

        const fromMe = msg.key.fromMe === true
        const participantJid = msg.key.participant || ''
        const pushName = msg.pushName || ''
        const senderPhone = (participantJid || remoteJid).split('@')[0].replace(/\D/g, '')
        const isOwnSender = fromMe || (ownerDigits && senderPhone === ownerDigits)
        const validPush = isOwnSender || isInvalidName(pushName) ? '' : pushName

        let content = ''
        let msgType = typeKey
        if (typeKey === 'conversation') {
          content = msg.message.conversation || ''
        } else if (typeKey === 'extendedTextMessage') {
          content = (msg.message.extendedTextMessage || {}).text || ''
        } else if (
          [
            'imageMessage',
            'videoMessage',
            'audioMessage',
            'documentMessage',
            'stickerMessage',
          ].indexOf(typeKey) !== -1
        ) {
          content = (msg.message[typeKey] || {}).caption || ''
        }

        try {
          const newMsg = new Record(msgCol)
          newMsg.set('user_id', userId)
          if (accountId) newMsg.set('account_id', accountId)
          newMsg.set('instance_name', realInstance)
          newMsg.set('remote_jid', remoteJid)
          newMsg.set('from_me', fromMe)
          newMsg.set('message_id', messageId)
          newMsg.set('push_name', validPush || (fromMe ? pushName : ''))
          newMsg.set('content', content)
          newMsg.set('message_type', msgType)
          newMsg.set('status', fromMe ? 'pending' : 'received')
          newMsg.set('timestamp', msgTs || Math.floor(Date.now() / 1000))
          if (msgCol.fields.getByName('participant_jid')) {
            newMsg.set('participant_jid', participantJid)
          }
          if (msgCol.fields.getByName('participant_pushname')) {
            newMsg.set('participant_pushname', pushName)
          }
          $app.save(newMsg)
          convInserted++
          if (msgTs > newestTs) newestTs = msgTs
        } catch (saveErr) {
          result.errors.push('save ' + messageId + ': ' + String(saveErr))
        }
      }

      // Atualizar last_message / last_message_timestamp da conversa
      if (newestTs > 0 && newestTs > (conv.getInt('last_message_timestamp') || 0)) {
        try {
          conv.set('last_message_timestamp', newestTs)
          if (convInserted > 0) {
            const newer = messages
              .filter((m) => m && m.message && tsToUnix(m.messageTimestamp) === newestTs)
              .sort((a, b) => (b.key.fromMe === true ? 1 : 0) - (a.key.fromMe === true ? 1 : 0))
            if (newer.length > 0) {
              const tk = Object.keys(newer[0].message).find((k) => k !== 'messageContextInfo')
              const lastTxt = previewFor(
                tk,
                (newer[0].message[tk] || {}).text || (newer[0].message[tk] || {}).caption || '',
              )
              if (lastTxt) conv.set('last_message', lastTxt)
            }
          }
          $app.save(conv)
        } catch (_) {}
      }
      result.conversations.push({ jid: remoteJid, inserted: convInserted })
      result.totalInserted += convInserted
    }

    $app
      .logger()
      .info(
        'import_last_24h_done',
        'instance',
        realInstance,
        'inserted',
        result.totalInserted,
        'errors',
        result.errors.length,
      )
    return e.json(200, { success: true, result })
  },
  $apis.requireAuth(),
)
