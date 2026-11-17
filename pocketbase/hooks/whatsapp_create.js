routerAdd(
  'POST',
  '/backend/v1/whatsapp/create-instance',
  (e) => {
    const body = e.requestInfo().body || {}
    let instanceName = body.instance_name

    if (!instanceName) {
      return e.badRequestError('instance_name is required')
    }

    let accountId = body.account_id
    if (!accountId) {
      return e.badRequestError('account_id is required')
    }

    // Período de sincronização inicial em dias.
    // 0 = importar tudo. Default = 7. Aceita 1, 7, 30, 90 e 0.
    const allowedPeriods = [0, 1, 7, 30, 90]
    let syncPeriodDays = 7
    if (
      typeof body.syncPeriodDays === 'number' &&
      allowedPeriods.indexOf(body.syncPeriodDays) >= 0
    ) {
      syncPeriodDays = body.syncPeriodDays
    }

    // GUARD DE INSTÂNCIA ÚNICA CONNECTED: se esta conta JÁ tem uma instância
    // conectada (o número 24h), NÃO tocamos na Evolution API — retornamos a
    // instância existente com alreadyConnected: true. Evita criar instâncias
    // duplicadas e proteger o número que nunca pode ser desconectado.
    try {
      const connected = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        "account_id = {:aid} && status = 'connected'",
        { aid: accountId },
      )
      return e.json(200, {
        instanceName: connected.get('instance_name'),
        qrcodeBase64: '',
        status: 'connected',
        alreadyConnected: true,
      })
    } catch (_) {
      // nenhuma instância connected para esta conta — segue o fluxo normal de QR
    }

    const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
    const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

    if (!apiUrl || !apiKey) {
      return e.internalServerError('Evolution API config missing')
    }

    const headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    }

    let qrcodeBase64 = ''

    let webhookUrl = $secrets.get('PB_WEBHOOK_URL') || ''
    if (!webhookUrl) {
      const proto = e.request.header.get('X-Forwarded-Proto') || 'https'
      const host = e.request.host
      webhookUrl = proto + '://' + host + '/backend/v1/whatsapp/webhook'
    }

    const webhookConfig = webhookUrl
      ? {
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
        }
      : undefined

    let res = $http.send({
      url: apiUrl + '/instance/create',
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        reject_call: true,
        alwaysOnline: true,
        syncFullHistory: true,
        webhook: webhookConfig,
      }),
      timeout: 15,
    })

    let needsFallback = false

    if (res.statusCode === 200 || res.statusCode === 201) {
      if (res.json && res.json.qrcode && res.json.qrcode.base64) {
        qrcodeBase64 = res.json.qrcode.base64
      } else if (res.json && res.json.base64) {
        qrcodeBase64 = res.json.base64
      } else {
        needsFallback = true
      }
    } else {
      needsFallback = true
    }

    if (needsFallback) {
      let connectRes = $http.send({
        url: apiUrl + '/instance/connect/' + instanceName,
        method: 'GET',
        headers: headers,
        timeout: 15,
      })

      if (connectRes.statusCode === 200) {
        if (connectRes.json && connectRes.json.base64) {
          qrcodeBase64 = connectRes.json.base64
        }
      } else {
        return e.badRequestError(
          'Erro ao conectar com o servidor de mensagens. Tente novamente em instantes.',
        )
      }
    }

    if (!qrcodeBase64) {
      return e.badRequestError('QR Code não retornado pela Evolution API.')
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
      const col = $app.findCollectionByNameOrId('whatsapp_instances')
      record = new Record(col)
      record.set('user_id', e.auth.id)
      record.set('account_id', accountId)
      record.set('instance_name', instanceName)
    }

    // REGRA DE INSTÂNCIA ÚNICA: ao gerar um QR novo para esta conta, qualquer
    // OUTRA instância ainda em 'qrcode' (QR órfão de tentativa anterior) vira
    // 'disconnected'. Nunca apagamos registro nem limpamos qrcode_base64 delas
    // (apenas mudamos o status) — o histórico e os dados ficam intactos.
    // A instância connected (o número 24h do Dr. Caio) NUNCA é tocada.
    try {
      const orphans = $app.findRecordsByFilter(
        'whatsapp_instances',
        "account_id = {:aid} && status = 'qrcode' && instance_name != {:iname}",
        '-created',
        200,
        0,
        { aid: accountId, iname: instanceName },
      )
      for (let i = 0; i < orphans.length; i++) {
        try {
          orphans[i].set('status', 'disconnected')
          $app.saveNoValidate(orphans[i])
        } catch (_) {}
      }
    } catch (err) {
      $app.logger().warn('create-instance: falha ao arquivar instâncias qrcode órfãs', String(err))
    }

    record.set('status', 'qrcode')
    try {
      record.set('qrcode_base64', qrcodeBase64)
    } catch (_) {}
    try {
      record.set('sync_period_days', syncPeriodDays)
    } catch (_) {}
    // Como criamos com syncFullHistory:true, marcamos que a importação será
    // iniciada assim que o usuário parear. O webhook trackeia o progresso.
    try {
      record.set('is_importing_history', true)
      record.set('import_messages_count', 0)
      record.set('import_started_at', new Date().toISOString().replace('T', ' '))
      record.set('import_finished_at', '')
    } catch (_) {}
    $app.save(record)

    return e.json(200, {
      instanceName: instanceName,
      qrcodeBase64: qrcodeBase64,
      status: 'qrcode',
    })
  },
  $apis.requireAuth(),
)
