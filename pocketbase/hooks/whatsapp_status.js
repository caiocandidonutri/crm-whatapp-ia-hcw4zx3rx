routerAdd(
  'GET',
  '/backend/v1/whatsapp/instance-status',
  (e) => {
    const instanceName = e.request.url.query().get('instanceName')
    if (!instanceName) {
      return e.badRequestError('instanceName is required')
    }

    const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
    const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

    let record
    try {
      record = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'user_id = {:userId} && instance_name = {:name}',
        {
          userId: e.auth.id,
          name: instanceName,
        },
      )
    } catch (_) {
      return e.notFoundError('Instância não encontrada para este usuário')
    }

    const headers = { apikey: apiKey }

    let connectRes = $http.send({
      url: apiUrl + '/instance/connectionState/' + instanceName,
      method: 'GET',
      headers: headers,
      timeout: 10,
    })

    let status = 'disconnected'
    let rawState = ''

    if (connectRes.statusCode === 200 && connectRes.json && connectRes.json.instance) {
      rawState = connectRes.json.instance.state
      if (rawState === 'open') {
        status = 'connected'
        record.set('status', 'connected')
        $app.save(record)

        let webhookUrl = $secrets.get('PB_WEBHOOK_URL') || ''
        if (!webhookUrl) {
          const proto = e.request.header.get('X-Forwarded-Proto') || 'https'
          webhookUrl = proto + '://' + e.request.host + '/backend/v1/whatsapp/webhook'
        }

        if (webhookUrl) {
          try {
            $http.send({
              url: apiUrl + '/webhook/set/' + instanceName,
              method: 'POST',
              headers: headers,
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
            $app.logger().error('Failed to configure webhook', 'instanceName', instanceName)
          }
        }

        return e.json(200, { status: 'connected', state: rawState, instanceName: instanceName })
      }
    }

    let qrcodeBase64 = ''

    if (rawState !== 'connecting' && rawState !== 'open') {
      // Tentar primeiro o cache: webhook qrcode.updated mantém este campo atualizado
      // a cada novo QR que a Evolution gera. Evita chamar /connect a cada poll
      // (3s), o que invalidaria o QR anterior antes do usuário conseguir ler.
      let cachedQr = ''
      try {
        cachedQr = record.getString('qrcode_base64') || ''
      } catch (_) {}

      if (cachedQr) {
        if (record.getString('status') !== 'qrcode') {
          record.set('status', 'qrcode')
          $app.save(record)
        }
        return e.json(200, {
          status: 'qrcode',
          state: rawState,
          qrcodeBase64: cachedQr,
          instanceName: instanceName,
        })
      }

      // Sem cache (primeira vez ou pós-deploy): chamar /connect uma vez para
      // obter o QR inicial. As próximas atualizações virão via webhook.
      let res = $http.send({
        url: apiUrl + '/instance/connect/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })

      if (res.statusCode === 200 && res.json && res.json.base64) {
        status = 'qrcode'
        qrcodeBase64 = res.json.base64
        if (record.getString('status') !== 'qrcode') {
          record.set('status', 'qrcode')
        }
        try {
          record.set('qrcode_base64', qrcodeBase64)
        } catch (_) {}
        $app.save(record)
        return e.json(200, {
          status: 'qrcode',
          state: rawState,
          qrcodeBase64: qrcodeBase64,
          instanceName: instanceName,
        })
      }
    }

    return e.json(200, {
      status: record.getString('status') || status,
      state: rawState,
      instanceName: instanceName,
    })
  },
  $apis.requireAuth(),
)
