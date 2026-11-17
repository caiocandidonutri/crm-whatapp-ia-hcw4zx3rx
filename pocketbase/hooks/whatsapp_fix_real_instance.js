// Corrige o roteamento do espelhamento: a sessão REAL do WhatsApp vive na
// instância que a Evolution API reporta como connected via /instance/fetchInstances
// (ex.: instance_1786021758855 — que pode nem existir no banco local).
// Esta rota:
//   1. Lista todas as instâncias reais da Evolution com connectionStatus.
//   2. Na instância connected real, grava o webhook apontando SEMPRE para
//      /backend/v1/whatsapp/webhook (nunca /api/whatsapp/webhook) com os
//      eventos messages.upsert, messages.update e connection.update.
//   3. Atualiza whatsapp_instances (SOMENTE updates, ZERO deletes):
//      real connected = connected (+ phone_number); as demais = disconnected.
// Zero envio de mensagem; apenas leitura + webhook/set na instância real.
routerAdd(
  'POST',
  '/backend/v1/whatsapp/fix-real-instance-webhook',
  (e) => {
    const body = e.requestInfo().body || {}
    const authId = e.auth ? e.auth.id : ''
    const force = body.force === true

    const result = {
      instances: [],
      realConnectedInstance: null,
      webhookBefore: null,
      webhookAfter: null,
      webhookSet: null,
      dbUpdates: [],
      errors: [],
    }

    const urlStr = ($secrets.get('EVOLUTION_API_URL') || '').trim()
    const apiKey = ($secrets.get('EVOLUTION_API_KEY') || '').trim()
    if (!urlStr || !apiKey) {
      return e.json(500, { success: false, error: 'evolution_config_missing' })
    }
    const baseUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    const headers = { apikey: apiKey, 'Content-Type': 'application/json' }

    // Webhook alvo: PB_WEBHOOK_URL > PB_INSTANCE_URL + rota > request host
    let webhookUrl = ($secrets.get('PB_WEBHOOK_URL') || '').trim()
    if (!webhookUrl) {
      const instanceUrl = ($secrets.get('PB_INSTANCE_URL') || '').trim()
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
    result.targetWebhookUrl = webhookUrl

    // 1. LISTAR instâncias reais da Evolution com status de conexão
    let evoInstances = []
    try {
      const res = $http.send({
        url: baseUrl + '/instance/fetchInstances',
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      if (res.statusCode >= 200 && res.statusCode < 300 && Array.isArray(res.json)) {
        evoInstances = res.json
      } else {
        result.errors.push('fetchInstances status ' + res.statusCode)
      }
    } catch (err) {
      result.errors.push('fetchInstances error: ' + String(err))
      return e.json(502, { success: false, result })
    }

    const summary = []
    for (let i = 0; i < evoInstances.length; i++) {
      const inst = evoInstances[i] || {}
      const name = inst.name || inst.instanceName || inst.instance || ''
      let connStatus = ''
      if (inst.connectionStatus) connStatus = inst.connectionStatus
      else if (inst.instance && inst.instance.connectionStatus)
        connStatus = inst.instance.connectionStatus
      else if (inst.state) connStatus = inst.state
      summary.push({ name: name, connectionStatus: connStatus })
    }
    result.instances = summary
    $app
      .logger()
      .info('fix_real_instance_list', 'count', summary.length, 'list', JSON.stringify(summary))

    // 2. Identificar a instância REALMENTE connected
    const real = summary.find(
      (s) => s.name && (s.connectionStatus === 'open' || s.connectionStatus === 'connected'),
    )
    if (!real) {
      result.errors.push('nenhuma instância connected na Evolution API')
      return e.json(200, { success: false, result })
    }
    result.realConnectedInstance = real.name

    // 3. Webhook before / set / after na instância real
    try {
      const before = $http.send({
        url: baseUrl + '/webhook/find/' + real.name,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.webhookBefore = before.json || null
    } catch (err) {
      result.webhookBefore = { error: String(err) }
    }

    const beforeUrl =
      result.webhookBefore && result.webhookBefore.url
        ? result.webhookBefore.url
        : result.webhookBefore && result.webhookBefore.webhook
          ? result.webhookBefore.webhook.url
          : ''

    if (force || beforeUrl !== webhookUrl) {
      try {
        const setRes = $http.send({
          url: baseUrl + '/webhook/set/' + real.name,
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrl,
              byEvents: false,
              base64: true,
              events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
            },
          }),
          timeout: 15,
        })
        result.webhookSet = { statusCode: setRes.statusCode, body: setRes.json || null }
      } catch (err) {
        result.webhookSet = { error: String(err) }
        result.errors.push('webhook/set falhou: ' + String(err))
      }
    } else {
      result.webhookSet = { skipped: true, reason: 'webhook já correto' }
    }

    try {
      const after = $http.send({
        url: baseUrl + '/webhook/find/' + real.name,
        method: 'GET',
        headers: headers,
        timeout: 10,
      })
      result.webhookAfter = after.json || null
    } catch (err) {
      result.webhookAfter = { error: String(err) }
    }

    const afterUrl =
      result.webhookAfter && result.webhookAfter.url
        ? result.webhookAfter.url
        : result.webhookAfter && result.webhookAfter.webhook
          ? result.webhookAfter.webhook.url
          : ''
    result.webhookMatches = afterUrl === webhookUrl

    // 4. Atualizar whatsapp_instances: SOMENTE updates, ZERO deletes
    let localRecords = []
    try {
      localRecords = $app.findRecordsByFilter('whatsapp_instances', '', '', 100, 0)
    } catch (err) {
      result.errors.push('db read error: ' + String(err))
    }
    let realPhoneNumber = ''
    try {
      const connInfo = evoInstances.find((x) => (x.name || x.instanceName || '') === real.name)
      const profName = connInfo && connInfo.profileName ? connInfo.profileName : ''
      const owner =
        connInfo && connInfo.ownerJid
          ? connInfo.ownerJid
          : connInfo && connInfo.instance && connInfo.instance.ownerJid
            ? connInfo.instance.ownerJid
            : ''
      const digits = String(owner).split('@')[0].replace(/\D/g, '')
      if (digits) realPhoneNumber = digits
    } catch (_) {}

    const nowIso = new Date().toISOString()
    for (let r = 0; r < localRecords.length; r++) {
      const rec = localRecords[r]
      const name = rec.getString('instance_name')
      const newStatus = name === real.name ? 'connected' : 'disconnected'
      const changed = rec.getString('status') !== newStatus
      if (force || changed) {
        try {
          rec.set('status', newStatus)
          if (name === real.name) {
            rec.set('last_webhook_reconfigured_at', nowIso)
            if (realPhoneNumber && rec.getString('phone_number') !== realPhoneNumber) {
              rec.set('phone_number', realPhoneNumber)
            }
          }
          $app.save(rec)
          result.dbUpdates.push({
            id: rec.id,
            instance_name: name,
            status: newStatus,
            changed: changed,
          })
        } catch (err) {
          result.errors.push('db update ' + name + ': ' + String(err))
        }
      }
    }

    // Se a instância real NÃO existe no banco local, criar o registro
    // (nunca apagar; isso fecha o buraco de instância-órfã).
    const exists = localRecords.some((r) => r.getString('instance_name') === real.name)
    if (!exists) {
      try {
        const col = $app.findCollectionByNameOrId('whatsapp_instances')
        const newRec = new Record(col)
        newRec.set('instance_name', real.name)
        newRec.set('status', 'connected')
        if (realPhoneNumber) newRec.set('phone_number', realPhoneNumber)
        newRec.set('last_webhook_reconfigured_at', nowIso)
        if (authId) newRec.set('user_id', authId)
        try {
          const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:u}', {
            u: authId,
          })
          if (member && member.getString('account_id')) {
            newRec.set('account_id', member.getString('account_id'))
          }
        } catch (_) {}
        $app.save(newRec)
        result.dbUpdates.push({ created: true, instance_name: real.name, status: 'connected' })
      } catch (err) {
        result.errors.push('db create real instance: ' + String(err))
      }
    }

    $app
      .logger()
      .info(
        'fix_real_instance_done',
        'real',
        real.name,
        'webhook',
        webhookUrl,
        'updates',
        JSON.stringify(result.dbUpdates),
      )
    return e.json(200, { success: true, result })
  },
  $apis.requireAuth(),
)
