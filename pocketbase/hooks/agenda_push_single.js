/// <reference path="../pb_data/types.d.ts" />

/**
 * PUSH IMEDIATO DE AGENDAMENTOS CRIADOS/EDITADOS LOCALMENTE (source="crm")
 *
 * Sempre que um agendamento for criado ou atualizado no CRM:
 * - Se source === 'crm', tenta fazer o push imediato para o PocketBase externo do Dr. Caio
 * - Se sucesso, grava external_id retornado, last_synced_at = now e limpa sync_error
 * - Se falhar, registra sync_error detalhado para ser reprocessado no cron a cada 5 min
 *
 * NOTA: Toda a lógica de execução fica ESTRITAMENTE dentro dos callbacks registrados,
 * pois a plataforma rejeita execução de funções/variáveis em escopo de módulo.
 */

onRecordAfterCreateSuccess((e) => {
  try {
    var record = e.record
    if (!record || record.getString('source') !== 'crm') return e.next()

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

    if (!extUrl || !extEmail || !extPass) {
      record.set('sync_error', 'Sincronia não configurada (faltam credenciais AGENDA_SYNC_*)')
      $app.saveNoValidate(record)
      return e.next()
    }

    // 1. Auth no PB externo
    var extToken = ''
    try {
      var authRes = $http.send({
        url: extUrl + '/api/collections/users/auth-with-password',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: extEmail, password: extPass }),
        timeout: 10,
      })

      if (authRes.statusCode !== 200 || !authRes.json || !authRes.json.token) {
        record.set('sync_error', 'Falha de auth PB externo (HTTP ' + authRes.statusCode + ')')
        $app.saveNoValidate(record)
        return e.next()
      }

      extToken = authRes.json.token
    } catch (authErr) {
      record.set('sync_error', 'Conexão falhou: ' + String(authErr).substring(0, 150))
      $app.saveNoValidate(record)
      return e.next()
    }

    var authHeaders = {
      'Content-Type': 'application/json',
      Authorization: extToken,
    }

    // 2. Descobrir coleção remota
    var targetExtCollection = 'appointments'
    try {
      var testReq = $http.send({
        url: extUrl + '/api/collections/appointments/records?perPage=1',
        method: 'GET',
        headers: authHeaders,
        timeout: 5,
      })
      if (testReq.statusCode === 404) {
        targetExtCollection = 'agendamentos'
      }
    } catch (_) {
      targetExtCollection = 'appointments'
    }

    // 3. Montar payload
    var extIdForPush = record.getString('external_id')
    var payload = {
      patient_name: record.getString('patient_name'),
      patient_phone: record.getString('patient_phone'),
      doctor: record.getString('doctor') || 'Dr. Caio',
      city: record.getString('city'),
      location: record.getString('location'),
      starts_at: record.getString('starts_at'),
      ends_at: record.getString('ends_at'),
      status: record.getString('status'),
      appointment_type: record.getString('appointment_type'),
      notes: record.getString('notes'),
      source: 'crm',
    }

    var pushUrl = extUrl + '/api/collections/' + targetExtCollection + '/records'
    var pushMethod = 'POST'
    if (extIdForPush) {
      pushUrl += '/' + extIdForPush
      pushMethod = 'PATCH'
    }

    try {
      var pushRes = $http.send({
        url: pushUrl,
        method: pushMethod,
        headers: authHeaders,
        body: JSON.stringify(payload),
        timeout: 10,
      })

      if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
        if (pushRes.json && pushRes.json.id) {
          record.set('external_id', pushRes.json.id)
        }
        record.set('last_synced_at', new Date().toISOString())
        record.set('sync_error', '')
        $app.saveNoValidate(record)
        $app.logger().info('agenda_push_appointment (create): success', 'id', record.id)
      } else {
        var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '')
        record.set('sync_error', pushErr.slice(0, 300))
        $app.saveNoValidate(record)
      }
    } catch (pushErrEx) {
      var exString = 'Push falhou: ' + String(pushErrEx)
      record.set('sync_error', exString.slice(0, 300))
      $app.saveNoValidate(record)
    }
  } catch (err) {
    $app.logger().error('onRecordAfterCreate appointments error', 'error', String(err))
  }
  return e.next()
}, 'appointments')

onRecordAfterUpdateSuccess((e) => {
  try {
    var record = e.record
    if (!record || record.getString('source') !== 'crm') return e.next()

    // Evita loop infinito se a própria função alterou apenas last_synced_at, external_id ou sync_error
    var origUpdated = record.original().getString('updated')
    var curUpdated = record.getString('updated')
    var origSync = record.original().getString('last_synced_at')
    var curSync = record.getString('last_synced_at')
    if (origSync !== curSync && origUpdated === curUpdated) {
      return e.next()
    }

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

    if (!extUrl || !extEmail || !extPass) {
      record.set('sync_error', 'Sincronia não configurada (faltam credenciais AGENDA_SYNC_*)')
      $app.saveNoValidate(record)
      return e.next()
    }

    // 1. Auth no PB externo
    var extToken = ''
    try {
      var authRes = $http.send({
        url: extUrl + '/api/collections/users/auth-with-password',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: extEmail, password: extPass }),
        timeout: 10,
      })

      if (authRes.statusCode !== 200 || !authRes.json || !authRes.json.token) {
        record.set('sync_error', 'Falha de auth PB externo (HTTP ' + authRes.statusCode + ')')
        $app.saveNoValidate(record)
        return e.next()
      }

      extToken = authRes.json.token
    } catch (authErr) {
      record.set('sync_error', 'Conexão falhou: ' + String(authErr).substring(0, 150))
      $app.saveNoValidate(record)
      return e.next()
    }

    var authHeaders = {
      'Content-Type': 'application/json',
      Authorization: extToken,
    }

    // 2. Descobrir coleção remota
    var targetExtCollection = 'appointments'
    try {
      var testReq = $http.send({
        url: extUrl + '/api/collections/appointments/records?perPage=1',
        method: 'GET',
        headers: authHeaders,
        timeout: 5,
      })
      if (testReq.statusCode === 404) {
        targetExtCollection = 'agendamentos'
      }
    } catch (_) {
      targetExtCollection = 'appointments'
    }

    // 3. Montar payload
    var extIdForPush = record.getString('external_id')
    var payload = {
      patient_name: record.getString('patient_name'),
      patient_phone: record.getString('patient_phone'),
      doctor: record.getString('doctor') || 'Dr. Caio',
      city: record.getString('city'),
      location: record.getString('location'),
      starts_at: record.getString('starts_at'),
      ends_at: record.getString('ends_at'),
      status: record.getString('status'),
      appointment_type: record.getString('appointment_type'),
      notes: record.getString('notes'),
      source: 'crm',
    }

    var pushUrl = extUrl + '/api/collections/' + targetExtCollection + '/records'
    var pushMethod = 'POST'
    if (extIdForPush) {
      pushUrl += '/' + extIdForPush
      pushMethod = 'PATCH'
    }

    try {
      var pushRes = $http.send({
        url: pushUrl,
        method: pushMethod,
        headers: authHeaders,
        body: JSON.stringify(payload),
        timeout: 10,
      })

      if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
        if (pushRes.json && pushRes.json.id) {
          record.set('external_id', pushRes.json.id)
        }
        record.set('last_synced_at', new Date().toISOString())
        record.set('sync_error', '')
        $app.saveNoValidate(record)
        $app.logger().info('agenda_push_appointment (update): success', 'id', record.id)
      } else {
        var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '')
        record.set('sync_error', pushErr.slice(0, 300))
        $app.saveNoValidate(record)
      }
    } catch (pushErrEx) {
      var exString = 'Push falhou: ' + String(pushErrEx)
      record.set('sync_error', exString.slice(0, 300))
      $app.saveNoValidate(record)
    }
  } catch (err) {
    $app.logger().error('onRecordAfterUpdate appointments error', 'error', String(err))
  }
  return e.next()
}, 'appointments')
