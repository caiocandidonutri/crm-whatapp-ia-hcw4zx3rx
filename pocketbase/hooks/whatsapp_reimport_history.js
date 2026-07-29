routerAdd(
  'POST',
  '/backend/v1/whatsapp/reimport-history',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const instanceName = body.instanceName || body.instance_name
      if (!instanceName) {
        return e.badRequestError('instanceName é obrigatório')
      }

      const allowedPeriods = [0, 1, 7, 30, 90]
      let syncPeriodDays = 7
      if (
        typeof body.syncPeriodDays === 'number' &&
        allowedPeriods.indexOf(body.syncPeriodDays) >= 0
      ) {
        syncPeriodDays = body.syncPeriodDays
      }

      const authId = e.auth.id

      // Validar ownership
      let instanceRecord
      try {
        instanceRecord = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name} && user_id = {:userId}',
          { name: instanceName, userId: authId },
        )
      } catch (_) {
        return e.badRequestError('instance_not_found')
      }

      const urlStr = $secrets.get('EVOLUTION_API_URL') || ''
      const apiUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : urlStr
      const apiKey = $secrets.get('EVOLUTION_API_KEY') || ''
      if (!apiUrl || !apiKey) {
        return e.json(500, { success: false, error: 'evolution_config_missing' })
      }

      const headers = { 'Content-Type': 'application/json', apikey: apiKey }

      // 1. Setar syncFullHistory enquanto ainda conectado
      try {
        const settingsRes = $http.send({
          url: apiUrl + '/settings/set/' + instanceName,
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            rejectCall: true,
            msgCall: '',
            groupsIgnore: false,
            alwaysOnline: true,
            readMessages: false,
            readStatus: false,
            syncFullHistory: true,
          }),
          timeout: 10,
        })
        $app
          .logger()
          .info('reimport_settings_set', 'instance', instanceName, 'status', settingsRes.statusCode)
      } catch (err) {
        $app
          .logger()
          .warn('reimport_settings_set_error', 'instance', instanceName, 'error', String(err))
      }

      // 2. Logout (despareia o aparelho)
      try {
        const logoutRes = $http.send({
          url: apiUrl + '/instance/logout/' + instanceName,
          method: 'DELETE',
          headers: { apikey: apiKey },
          timeout: 10,
        })
        $app
          .logger()
          .info('reimport_logout', 'instance', instanceName, 'status', logoutRes.statusCode)
      } catch (err) {
        $app.logger().warn('reimport_logout_error', 'instance', instanceName, 'error', String(err))
      }

      // Resetar campos de sync para que conversas existentes possam re-puxar histórico
      try {
        const conversations = $app.findRecordsByFilter(
          'conversations',
          'user_id = {:userId} && instance_name = {:name}',
          '+created',
          5000,
          0,
          { userId: authId, name: instanceName },
        )
        for (const conv of conversations) {
          try {
            conv.set('history_synced_at', '')
            conv.set('history_oldest_timestamp', 0)
            $app.save(conv)
          } catch (_) {}
        }
      } catch (_) {}

      // 3. Connect (gera novo QR para repareamento)
      let qrcodeBase64 = ''
      try {
        const connectRes = $http.send({
          url: apiUrl + '/instance/connect/' + instanceName,
          method: 'GET',
          headers: { apikey: apiKey },
          timeout: 15,
        })
        $app
          .logger()
          .info('reimport_connect', 'instance', instanceName, 'status', connectRes.statusCode)
        if (connectRes.statusCode === 200 && connectRes.json) {
          qrcodeBase64 = connectRes.json.base64 || ''
        }
      } catch (err) {
        $app
          .logger()
          .error('reimport_connect_error', 'instance', instanceName, 'error', String(err))
        return e.json(502, { success: false, error: 'connect_failed' })
      }

      if (!qrcodeBase64) {
        return e.json(502, { success: false, error: 'no_qrcode_returned' })
      }

      instanceRecord.set('status', 'qrcode')
      try {
        instanceRecord.set('qrcode_base64', qrcodeBase64)
      } catch (_) {}
      try {
        instanceRecord.set('sync_period_days', syncPeriodDays)
      } catch (_) {}
      // Marcar início da importação de histórico para o front exibir progresso.
      // O webhook messages.set vai incrementar import_messages_count, e marca
      // is_importing_history=false quando recebe isLatest=true do Baileys.
      try {
        instanceRecord.set('is_importing_history', true)
        instanceRecord.set('import_messages_count', 0)
        instanceRecord.set('import_started_at', new Date().toISOString().replace('T', ' '))
        instanceRecord.set('import_finished_at', '')
      } catch (_) {}
      $app.save(instanceRecord)

      return e.json(200, {
        success: true,
        qrcodeBase64: qrcodeBase64,
        instanceName: instanceName,
      })
    } catch (err) {
      $app.logger().error('reimport_history_fatal', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
