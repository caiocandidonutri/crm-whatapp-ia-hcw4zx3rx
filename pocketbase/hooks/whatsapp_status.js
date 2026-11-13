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

    if (!apiUrl) {
      return e.json(502, {
        status: 'error',
        error: 'URL da API do WhatsApp não configurada',
        instanceName: instanceName,
      })
    }

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
      return e.json(404, {
        status: 'error',
        error: 'Instância não encontrada para este usuário',
        instanceName: instanceName,
      })
    }

    const headers = { apikey: apiKey }

    let connectRes
    try {
      connectRes = $http.send({
        url: apiUrl + '/instance/connectionState/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
    } catch (err) {
      $app
        .logger()
        .error(
          'Failed to reach Evolution API for connection state',
          'instanceName',
          instanceName,
          'error',
          String(err),
        )
      return e.json(502, {
        status: 'error',
        error: 'Não foi possível conectar à API do WhatsApp',
        instanceName: instanceName,
      })
    }

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
      let cachedQr = ''
      try {
        cachedQr = record.getString('qrcode_base64') || ''
      } catch (_) {}

      // QR do WhatsApp expira em ~60s. Só devolve o QR em cache se ele nasceu
      // há menos de 55s (qr_updated_at). Caso contrário, SEMPRE chamar
      // /instance/connect/{name} para gerar um QR novo — devolver QR morto
      // fazia o usuário escanear um código que já não valia nada, sem erro.
      if (cachedQr) {
        let qrUpdatedAt = 0
        try {
          const s = record.getString('qr_updated_at') || ''
          if (s) qrUpdatedAt = new Date(s).getTime()
        } catch (_) {}
        const qrAgeMs = Date.now() - qrUpdatedAt
        const qrFresh = qrUpdatedAt > 0 && qrAgeMs >= 0 && qrAgeMs < 55000

        if (qrFresh) {
          if (record.getString('status') !== 'qrcode') {
            record.set('status', 'qrcode')
            $app.save(record)
          }
          return e.json(200, {
            status: 'qrcode',
            state: rawState,
            qrcodeBase64: cachedQr,
            qrUpdatedAt: new Date(qrUpdatedAt).toISOString(),
            instanceName: instanceName,
          })
        }
        // QR expirado: limpa o cache para forçar o connect abaixo.
        cachedQr = ''
        try {
          record.set('qrcode_base64', '')
          $app.saveNoValidate(record)
        } catch (_) {}
      }

      let res
      try {
        res = $http.send({
          url: apiUrl + '/instance/connect/' + instanceName,
          method: 'GET',
          headers: headers,
          timeout: 10,
        })
      } catch (err) {
        $app
          .logger()
          .error(
            'Failed to reach Evolution API for QR code',
            'instanceName',
            instanceName,
            'error',
            String(err),
          )
        return e.json(502, {
          status: 'error',
          error: 'Não foi possível obter o QR Code da API do WhatsApp',
          instanceName: instanceName,
        })
      }

      if (res.statusCode === 200 && res.json && res.json.base64) {
        status = 'qrcode'
        qrcodeBase64 = res.json.base64
        const qrNow = new Date()
        if (record.getString('status') !== 'qrcode') {
          record.set('status', 'qrcode')
        }
        try {
          record.set('qrcode_base64', qrcodeBase64)
        } catch (_) {}
        try {
          record.set('qr_updated_at', qrNow)
        } catch (_) {}
        $app.save(record)
        return e.json(200, {
          status: 'qrcode',
          state: rawState,
          qrcodeBase64: qrcodeBase64,
          qrUpdatedAt: qrNow.toISOString(),
          instanceName: instanceName,
        })
      }

      if (res.statusCode !== 200) {
        return e.json(502, {
          status: 'error',
          error: 'Erro ao comunicar com a API do WhatsApp (código ' + res.statusCode + ')',
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
