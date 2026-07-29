routerAdd(
  'POST',
  '/backend/v1/whatsapp/disconnect',
  (e) => {
    const body = e.requestInfo().body || {}
    const instanceName = body.instanceName
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
      return e.json(200, { success: true })
    }

    const headers = { apikey: apiKey }

    $http.send({
      url: apiUrl + '/instance/logout/' + instanceName,
      method: 'DELETE',
      headers: headers,
      timeout: 10,
    })

    $http.send({
      url: apiUrl + '/instance/delete/' + instanceName,
      method: 'DELETE',
      headers: headers,
      timeout: 10,
    })

    $app.delete(record)

    return e.json(200, { success: true })
  },
  $apis.requireAuth(),
)
