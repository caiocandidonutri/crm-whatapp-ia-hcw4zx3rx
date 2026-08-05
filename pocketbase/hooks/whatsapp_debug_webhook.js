routerAdd(
  'POST',
  '/backend/v1/whatsapp/debug-webhook',
  (e) => {
    const body = e.requestInfo().body || {}
    const instanceName = body.instanceName

    if (!instanceName) {
      return e.badRequestError('Nome da instância não fornecido.')
    }

    let instanceRecord
    try {
      const records = $app.findRecordsByFilter(
        'whatsapp_instances',
        'instance_name = {:instanceName} && user_id = {:userId}',
        '-created',
        1,
        0,
        { instanceName: instanceName, userId: e.auth.id },
      )
      if (records.length === 0) {
        return e.notFoundError('Instância não encontrada ou não pertence a você.')
      }
      instanceRecord = records[0]
    } catch (err) {
      return e.notFoundError('Erro ao buscar instância.')
    }

    const apiUrl = $secrets.get('EVOLUTION_API_URL')
    const apiKey = $secrets.get('EVOLUTION_API_KEY')

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

    const result = {
      instanceName: instanceName,
      expectedWebhookUrl: webhookUrl || null,
      localStatus: instanceRecord.getString('status'),
      evolutionConnectionState: null,
      realConnected: false,
      webhookBefore: null,
      webhookSetResult: null,
      webhookAfter: null,
      matches: false,
      webhookWasFixed: false,
      lastMessage: null,
      syncStale: null,
      timestamp: new Date().toISOString(),
    }

    if (!apiUrl || !apiKey) {
      result.error = 'Configurações ausentes: EVOLUTION_API_URL e/ou EVOLUTION_API_KEY.'
      return e.json(200, result)
    }

    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
    const headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    }

    try {
      const resConn = $http.send({
        url: baseUrl + '/instance/connectionState/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.evolutionConnectionState = {
        statusCode: resConn.statusCode,
        body: resConn.json || null,
      }
      if (
        resConn.statusCode === 200 &&
        resConn.json &&
        resConn.json.instance &&
        resConn.json.instance.state === 'open'
      ) {
        result.realConnected = true
      }
    } catch (err) {
      $app.logger().error('debug_webhook_conn_error', 'err', err.message)
      result.evolutionConnectionState = { error: err.message }
    }

    try {
      const resWhBefore = $http.send({
        url: baseUrl + '/webhook/find/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.webhookBefore = {
        statusCode: resWhBefore.statusCode,
        body: resWhBefore.json || null,
      }
    } catch (err) {
      $app.logger().error('debug_webhook_wh_before_error', 'err', err.message)
      result.webhookBefore = { error: err.message }
    }

    const urlBeforeRaw =
      result.webhookBefore && result.webhookBefore.body
        ? result.webhookBefore.body.url ||
          (result.webhookBefore.body.webhook && result.webhookBefore.body.webhook.url) ||
          ''
        : ''
    const isBeforeCorrect = urlBeforeRaw === webhookUrl

    if (!isBeforeCorrect) {
      try {
        const setBody = {
          webhook: {
            enabled: true,
            url: webhookUrl,
            byEvents: false,
            base64: true,
            events: [
              'QRCODE_UPDATED',
              'CONNECTION_UPDATE',
              'MESSAGES_UPSERT',
              'MESSAGES_UPDATE',
              'MESSAGES_SET',
              'MESSAGES_DELETE',
              'CHATS_UPSERT',
              'CHATS_UPDATE',
              'CONTACTS_UPSERT',
              'CONTACTS_UPDATE',
              'PRESENCE_UPDATE',
              'GROUPS_UPSERT',
              'GROUP_UPDATE',
            ],
          },
        }
        const resSetWh = $http.send({
          url: baseUrl + '/webhook/set/' + instanceName,
          method: 'POST',
          headers: headers,
          body: JSON.stringify(setBody),
          timeout: 15,
        })
        result.webhookSetResult = {
          statusCode: resSetWh.statusCode,
          body: resSetWh.json || null,
        }
      } catch (err) {
        $app.logger().error('debug_webhook_wh_set_error', 'err', err.message)
        result.webhookSetResult = { error: err.message }
      }
    }

    try {
      const resWhAfter = $http.send({
        url: baseUrl + '/webhook/find/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      const jsonAfter = resWhAfter.json || null
      result.webhookAfter = {
        statusCode: resWhAfter.statusCode,
        body: jsonAfter,
      }

      if (jsonAfter) {
        const actualUrl = jsonAfter.url || (jsonAfter.webhook && jsonAfter.webhook.url) || ''
        if (actualUrl === webhookUrl) {
          result.matches = true
        }
        if (!isBeforeCorrect && result.matches) {
          result.webhookWasFixed = true
        }
      }
    } catch (err) {
      $app.logger().error('debug_webhook_wh_after_error', 'err', err.message)
      result.webhookAfter = { error: err.message }
    }

    try {
      const lastMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'instance_name = {:name}',
        '-timestamp',
        1,
        0,
        { name: instanceName },
      )
      if (lastMsgs.length > 0) {
        const lastMsg = lastMsgs[0]
        const msgTs = lastMsg.getInt('timestamp') || 0
        const nowSecs = Math.floor(Date.now() / 1000)
        const secsAgo = msgTs > 0 ? nowSecs - msgTs : -1
        result.lastMessage = {
          timestamp: msgTs,
          secondsAgo: secsAgo,
          isoDate: msgTs > 0 ? new Date(msgTs * 1000).toISOString() : null,
          fromMe: lastMsg.getBool('from_me'),
          contentPreview: (lastMsg.getString('content') || '').substring(0, 120),
        }
      } else {
        result.lastMessage = null
      }
    } catch (err) {
      $app.logger().error('debug_webhook_last_msg_error', 'err', err.message)
      result.lastMessage = { error: String(err) }
    }

    if (result.realConnected) {
      if (!result.lastMessage || result.lastMessage.error) {
        result.syncStale = null
      } else if (result.lastMessage.secondsAgo < 0) {
        result.syncStale = true
      } else {
        result.syncStale = result.lastMessage.secondsAgo > 1800
      }
    } else {
      result.syncStale = null
    }

    return e.json(200, result)
  },
  $apis.requireAuth(),
)
