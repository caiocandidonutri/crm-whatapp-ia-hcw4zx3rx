// DIAGNÓSTICO: lista TODAS as instâncias da Evolution API com status real.
// GET /backend/v1/whatsapp/list-instances?token=... (ou header X-CRM-Token)
// Somente LEITURA (GET /instance/fetchInstances). Zero deletes, zero envio.
// Loga o resultado completo para os logs do backend (stream hooks).

var LIST_INSTANCES_TOKEN = 'crm_agenda_token_dr_caio_2026'

routerAdd('GET', '/backend/v1/whatsapp/list-instances', (e) => {
  var headerToken = e.request.header.get('X-CRM-Token') || ''
  var queryToken = e.request.url.query().get('token') || ''
  if (headerToken !== LIST_INSTANCES_TOKEN && queryToken !== LIST_INSTANCES_TOKEN) {
    return e.json(401, { success: false, error: 'unauthorized' })
  }

  var urlStr = $secrets.get('EVOLUTION_API_URL') || ''
  var apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
  var apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
  if (!apiUrl || !apiKey) {
    return e.json(500, { success: false, error: 'evolution_config_missing' })
  }

  var res
  try {
    res = $http.send({
      url: apiUrl + '/instance/fetchInstances',
      method: 'GET',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      timeout: 15,
    })
  } catch (err) {
    $app.logger().error('list_instances_http_error', 'err', String(err))
    return e.json(502, { success: false, error: 'evolution_request_failed' })
  }

  var list = res.json
  if (list && !Array.isArray(list) && list.instances && Array.isArray(list.instances)) {
    list = list.instances
  }

  var summary = []
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i++) {
      var it = list[i] || {}
      var name = it.instanceName || it.instance || it.name || ''
      var cs = it.connectionStatus || it.status || ''
      summary.push({
        name: name,
        connectionStatus: cs,
        owner: it.owner || '',
        profileName: it.profileName || '',
        webhook_wa_business: it.webhook_wa_business || '',
      })
    }
  }

  // Cruzar com o banco local (whatsapp_instances) — leitura apenas.
  var local = []
  try {
    var recs = $app.findRecordsByFilter('whatsapp_instances', '', '-created', 50, 0)
    for (var j = 0; j < recs.length; j++) {
      local.push({
        instance_name: recs[j].getString('instance_name'),
        status: recs[j].getString('status'),
        phone: recs[j].getString('phone_number') || '',
        account_id: recs[j].getString('account_id') || '',
        created: recs[j].getString('created'),
      })
    }
  } catch (_) {}

  $app
    .logger()
    .info('list_instances_result', 'total', summary.length, 'summary', JSON.stringify(summary))
  $app.logger().info('list_instances_local', 'local', JSON.stringify(local))

  return e.json(200, {
    success: true,
    evolution_status_code: res.statusCode,
    instances: summary,
    local_rows: local,
    timestamp: new Date().toISOString(),
  })
})
