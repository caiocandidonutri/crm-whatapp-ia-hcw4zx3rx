// HEALTH CHECK DE CONEXÃO WHATSAPP
// Espaçado de cada 5 min para 1x por hora no minuto 51 ('51 * * * *')
// Timeout de 3s em todas as chamadas de rede e limite de 1 instância por ciclo
cronAdd('health_check', '51 * * * *', function () {
  try {
    // Anti-freeze: safety cycle limit
    var cycleStartMs = Date.now()
    var MAX_CYCLE_DURATION_MS = 5000
    var MAX_INSTANCES_PER_RUN = 1

    var urlStr = $secrets.get('EVOLUTION_API_URL') || ''
    var apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
    var apiKey = $secrets.get('EVOLUTION_API_KEY') || ''

    if (!apiUrl || !apiKey) {
      return
    }

    var headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    }

    var pbUrl = ($secrets.get('POCKETBASE_URL') || '').trim()
    var webhookUrl = pbUrl ? pbUrl.replace(/\/$/, '') + '/api/whatsapp/webhook' : ''
    var webhookEvents = [
      'MESSAGES_UPSERT',
      'MESSAGES_UPDATE',
      'CONNECTION_UPDATE',
      'CHATS_UPSERT',
      'CHATS_UPDATE',
    ]

    var instances = $app.findRecordsByFilter(
      'whatsapp_instances',
      "status != ''",
      '+last_health_check_at',
      MAX_INSTANCES_PER_RUN,
      0,
    )

    for (var i = 0; i < instances.length; i++) {
      if (Date.now() - cycleStartMs > MAX_CYCLE_DURATION_MS) {
        break
      }

      var instance = instances[i]
      var instanceName = instance.getString('name')
      var currentStatus = instance.getString('status')
      var disconnectedAt = instance.getString('disconnected_at')

      if (!instanceName) continue

      try {
        instance.set('last_health_check_at', new Date().toISOString().replace('T', ' '))

        var resConn = $http.send({
          url: apiUrl + '/instance/connectionState/' + instanceName,
          method: 'GET',
          headers: headers,
          timeout: 3,
        })

        if (resConn.statusCode !== 200) {
          $app.save(instance)
          continue
        }

        var connState = ''
        if (resConn.json && resConn.json.instance && resConn.json.instance.state) {
          connState = resConn.json.instance.state
        } else if (resConn.json && resConn.json.state) {
          connState = resConn.json.state
        }

        if (connState === 'open') {
          if (currentStatus !== 'connected') {
            instance.set('status', 'connected')
            instance.set('disconnected_at', '')
            instance.set('auto_reconnect_attempts', 0)
            instance.set('last_connected_at', new Date().toISOString().replace('T', ' '))

            try {
              var resWh = $http.send({
                url: apiUrl + '/webhook/find/' + instanceName,
                method: 'GET',
                headers: headers,
                timeout: 3,
              })
              var currentWh = resWh.statusCode === 200 ? resWh.json : null
              var isWhConfigured =
                currentWh && currentWh.enabled === true && currentWh.url === webhookUrl

              if (!isWhConfigured && webhookUrl) {
                $http.send({
                  url: apiUrl + '/webhook/set/' + instanceName,
                  method: 'POST',
                  headers: headers,
                  body: JSON.stringify({
                    enabled: true,
                    url: webhookUrl,
                    byEvents: false,
                    base64: true,
                    events: webhookEvents,
                  }),
                  timeout: 3,
                })
              }
            } catch (_) {}
          }
        } else if (connState === 'close' || connState === 'connecting') {
          if (currentStatus === 'connected') {
            instance.set('status', 'disconnected')
            if (!disconnectedAt) {
              instance.set('disconnected_at', new Date().toISOString().replace('T', ' '))
            }
          }

          var attempts = instance.getInt('auto_reconnect_attempts') || 0
          if (attempts < 2) {
            instance.set('auto_reconnect_attempts', attempts + 1)
            $http.send({
              url: apiUrl + '/instance/restart/' + instanceName,
              method: 'POST',
              headers: headers,
              timeout: 3,
            })
          }
        }

        $app.save(instance)
      } catch (err) {
        $app.logger().warn('health_check_instance_error', 'error', String(err))
      }
    }
  } catch (fatalErr) {
    $app.logger().error('cron_health_check_fatal', 'error', String(fatalErr))
  }
})
