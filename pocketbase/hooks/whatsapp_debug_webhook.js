routerAdd(
  'POST',
  '/backend/v1/whatsapp/debug-webhook',
  (e) => {
    const body = e.requestInfo().body || {}
    const instanceName = body.instanceName

    if (!instanceName) {
      return e.badRequestError('Nome da instância não fornecido.')
    }

    // Check ownership
    let instanceRecord
    try {
      const records = $app.findRecordsByFilter(
        'whatsapp_instances',
        `instance_name = {:instanceName} && user_id = {:userId}`,
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
    let webhookUrl = $secrets.get('PB_WEBHOOK_URL')

    if (!webhookUrl) {
      const proto = e.request.header.get('X-Forwarded-Proto') || 'https'
      webhookUrl = proto + '://' + e.request.host + '/backend/v1/whatsapp/webhook'
    }

    const result = {
      instanceName: instanceName,
      expectedWebhookUrl: webhookUrl || null,
      localStatus: instanceRecord.getString('status'),
      evolutionConnectionState: null,
      webhookBefore: null,
      webhookSetResult: null,
      webhookAfter: null,
      matches: false,
      timestamp: new Date().toISOString(),
    }

    if (!apiUrl || !apiKey) {
      result.error =
        'Configurações ausentes: EVOLUTION_API_URL e/ou EVOLUTION_API_KEY (PB_WEBHOOK_URL é opcional — fallback automático para o host atual).'
      return e.json(200, result)
    }

    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl
    const headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    }

    // 1. Check Connection
    try {
      const resConn = $http.send({
        url: `${baseUrl}/instance/connectionState/${instanceName}`,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.evolutionConnectionState = {
        statusCode: resConn.statusCode,
        body: resConn.json || null,
      }
    } catch (err) {
      $app.logger().error('Error checking connection in webhook debug', 'err', err.message)
      result.evolutionConnectionState = { error: err.message }
    }

    // 2. Retrieve Current Webhook
    try {
      const resWhBefore = $http.send({
        url: `${baseUrl}/webhook/find/${instanceName}`,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.webhookBefore = {
        statusCode: resWhBefore.statusCode,
        body: resWhBefore.json || null,
      }
    } catch (err) {
      $app.logger().error('Error getting webhook before in debug', 'err', err.message)
      result.webhookBefore = { error: err.message }
    }

    // 3. Set Webhook
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
        url: `${baseUrl}/webhook/set/${instanceName}`,
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
      $app.logger().error('Error setting webhook in debug', 'err', err.message)
      result.webhookSetResult = { error: err.message }
    }

    // 4. Verify Final Webhook
    try {
      const resWhAfter = $http.send({
        url: `${baseUrl}/webhook/find/${instanceName}`,
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
        const actualUrl = jsonAfter.url || (jsonAfter.webhook && jsonAfter.webhook.url)
        if (actualUrl === webhookUrl) {
          result.matches = true
        }
      }
    } catch (err) {
      $app.logger().error('Error getting webhook after in debug', 'err', err.message)
      result.webhookAfter = { error: err.message }
    }

    return e.json(200, result)
  },
  $apis.requireAuth(),
)
