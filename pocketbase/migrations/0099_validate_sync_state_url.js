/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    function sanitizeUrl(raw) {
      if (!raw) return ''
      var trimmed = String(raw).trim()
      if (!trimmed) return ''
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = 'https://' + trimmed
      }
      return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
    }

    var extUrl = sanitizeUrl($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '')
    var extEmail = (
      $secrets.get('AGENDA_SYNC_EMAIL') ||
      $os.getenv('AGENDA_SYNC_EMAIL') ||
      ''
    ).trim()
    var extPass = (
      $secrets.get('AGENDA_SYNC_PASSWORD') ||
      $os.getenv('AGENDA_SYNC_PASSWORD') ||
      ''
    ).trim()

    var syncKey = 'agenda_externa_dr_caio'
    var syncStateRec = null
    try {
      syncStateRec = app.findFirstRecordByData('sync_state', 'key', syncKey)
    } catch (_) {
      try {
        var col = app.findCollectionByNameOrId('sync_state')
        syncStateRec = new Record(col)
        syncStateRec.set('key', syncKey)
        app.save(syncStateRec)
      } catch (_) {}
    }

    if (!syncStateRec) return

    if (!extUrl || !extEmail || !extPass) {
      var missing = []
      if (!extUrl) missing.push('AGENDA_SYNC_URL')
      if (!extEmail) missing.push('AGENDA_SYNC_EMAIL')
      if (!extPass) missing.push('AGENDA_SYNC_PASSWORD')
      syncStateRec.set('last_status', 'missing_credentials')
      syncStateRec.set('last_error', 'Faltam credenciais: ' + missing.join(', '))
      syncStateRec.set(
        'details',
        JSON.stringify({ missing_envs: missing, checked_at: new Date().toISOString() }),
      )
      app.save(syncStateRec)
      return
    }

    var authPaths = [
      '/api/collections/users/auth-with-password',
      '/api/collections/_superusers/auth-with-password',
      '/api/admins/auth-with-password',
      '/api/collections/usuarios/auth-with-password',
    ]

    var authSuccess = false
    var lastStatusCode = 0
    var lastRaw = ''
    var winningPath = ''

    for (var i = 0; i < authPaths.length; i++) {
      var path = authPaths[i]
      try {
        var authRes = $http.send({
          url: extUrl + path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: extEmail, password: extPass }),
          timeout: 10,
        })
        lastStatusCode = authRes.statusCode
        lastRaw = String(authRes.raw || '').substring(0, 300)

        if (authRes.statusCode === 200 && authRes.json && authRes.json.token) {
          authSuccess = true
          winningPath = path
          break
        }
      } catch (e) {
        lastRaw = String(e)
      }
    }

    if (authSuccess) {
      syncStateRec.set('last_status', 'ok')
      syncStateRec.set('last_sync', new Date().toISOString())
      syncStateRec.set('last_error', '')
      syncStateRec.set(
        'details',
        JSON.stringify({
          validated_url: extUrl,
          auth_path: winningPath,
          auth_success: true,
          checked_at: new Date().toISOString(),
        }),
      )
      app.save(syncStateRec)
    } else {
      var errMsg =
        'Falha de autenticação externa (' +
        (lastStatusCode ? 'HTTP ' + lastStatusCode : 'Erro de rede') +
        '): ' +
        lastRaw
      syncStateRec.set('last_status', 'auth_failed')
      syncStateRec.set('last_error', errMsg.substring(0, 300))
      syncStateRec.set(
        'details',
        JSON.stringify({
          validated_url: extUrl,
          tested_paths: authPaths,
          last_status_code: lastStatusCode,
          checked_at: new Date().toISOString(),
        }),
      )
      app.save(syncStateRec)
    }
  },
  (app) => {},
)
