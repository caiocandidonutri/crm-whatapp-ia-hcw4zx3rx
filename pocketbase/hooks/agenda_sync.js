/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIZAÇÃO DE AGENDA (SKIP CLOUD)
 * Hook seguro, fail-safe e leve
 */

// 1. Cron periódico de sincronização da agenda (1x por hora; sincronização manual na tela /agenda sob demanda)
cronAdd('agenda_external_sync', '42 * * * *', () => {
  try {
    // Kill-switch global como PRIMEIRA instrução
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        return
      }
    } catch (_) {}

    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken =
      ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
      'crm_agenda_token_dr_caio_2026'

    if (!rawUrl) {
      return
    }

    var normalized = rawUrl
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized
    }

    var qIdx = normalized.indexOf('?')
    var pathOnly = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
    if (pathOnly.endsWith('/')) {
      pathOnly = pathOnly.slice(0, -1)
    }

    var pullUrl = ''
    if (pathOnly.indexOf('/backend/v1/crm-dados') !== -1) {
      pullUrl = normalized
    } else {
      pullUrl = pathOnly + '/backend/v1/crm-dados?tipo=tudo'
    }

    var headers = {
      Accept: 'application/json',
      'X-CRM-Token': rawToken,
      Authorization: 'Bearer ' + rawToken,
    }

    // Circuit breaker: exatamente 1 tentativa com timeout de 4s; em caso de falha registrar erro e retornar
    var res = null
    try {
      res = $http.send({
        url: pullUrl,
        method: 'GET',
        headers: headers,
        timeout: 4,
      })
    } catch (httpErr) {
      $app.logger().error('agenda_external_sync http error', 'error', String(httpErr))
      return
    }

    if (!res || res.statusCode !== 200) {
      $app
        .logger()
        .warn('agenda_external_sync non-200 response', 'statusCode', res ? res.statusCode : 0)
      return
    }

    var body = res.json
    if (!body && res.raw) {
      try {
        body = JSON.parse(res.raw)
      } catch (_) {}
    }

    if (!body) return

    var items = []
    if (Array.isArray(body)) {
      items = body
    } else if (body.agendamentos && Array.isArray(body.agendamentos)) {
      items = body.agendamentos
    } else if (body.appointments && Array.isArray(body.appointments)) {
      items = body.appointments
    } else if (body.dados && Array.isArray(body.dados)) {
      items = body.dados
    }

    if (items.length === 0) return

    var appointmentsCol = $app.findCollectionByNameOrId('appointments')

    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (!item || typeof item !== 'object') continue

      var rawStart = item.data_inicio || item.data_consulta || item.starts_at || item.data || ''
      if (!rawStart) continue

      var extId = String(item.id || item.external_id || '').trim()
      var patientName = String(
        item.patient_name || item.paciente_nome || item.nome || 'Paciente',
      ).trim()

      if (!extId) {
        extId = 'ext_' + $security.md5(patientName + '_' + String(rawStart))
      }

      var existing = null
      try {
        existing = $app.findFirstRecordByFilter(
          'appointments',
          'external_id = {:eid} && source = "agenda_externa"',
          { eid: extId },
        )
      } catch (_) {}

      var rec = existing || new Record(appointmentsCol)
      rec.set('source', 'agenda_externa')
      rec.set('external_id', extId)
      rec.set('patient_name', patientName)
      rec.set('patient_phone', item.patient_phone || item.paciente_telefone || item.telefone || '')
      rec.set('doctor', item.doctor || item.medico || 'Dr. Caio')
      rec.set('city', item.city || item.cidade || 'Carmo do Rio Claro')
      rec.set('location', item.location || item.local || 'Climed')

      var startsAtIso = String(rawStart)
      try {
        var d = new Date(startsAtIso)
        if (!isNaN(d.getTime())) {
          startsAtIso = d.toISOString()
        }
      } catch (_) {}

      rec.set('starts_at', startsAtIso)
      rec.set('status', item.status || 'agendado')
      rec.set('appointment_type', item.appointment_type || item.tipo_consulta || 'Consulta')
      rec.set('notes', item.notes || item.observacoes || '')
      rec.set('last_synced_at', new Date().toISOString())

      try {
        $app.save(rec)
      } catch (_) {}
    }
  } catch (fatalErr) {
    $app.logger().error('agenda_external_sync fatal error', 'error', String(fatalErr))
  }
})

// 2. Rota POST para sincronização manual acionada pelo usuário na tela da agenda
routerAdd('POST', '/backend/v1/agenda/sync', (e) => {
  try {
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken =
      ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
      'crm_agenda_token_dr_caio_2026'

    if (!rawUrl) {
      return e.json(400, {
        success: false,
        status: 'missing_credentials',
        message: 'AGENDA_SYNC_URL não configurada',
      })
    }

    var normalized = rawUrl
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized
    }

    var qIdx = normalized.indexOf('?')
    var pathOnly = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
    if (pathOnly.endsWith('/')) {
      pathOnly = pathOnly.slice(0, -1)
    }

    var pullUrl = ''
    if (pathOnly.indexOf('/backend/v1/crm-dados') !== -1) {
      pullUrl = normalized
    } else {
      pullUrl = pathOnly + '/backend/v1/crm-dados?tipo=tudo'
    }

    var headers = {
      Accept: 'application/json',
      'X-CRM-Token': rawToken,
      Authorization: 'Bearer ' + rawToken,
    }

    var res = null
    try {
      res = $http.send({
        url: pullUrl,
        method: 'GET',
        headers: headers,
        timeout: 5,
      })
    } catch (httpErr) {
      return e.json(502, {
        success: false,
        status: 'connection_error',
        message: 'Falha de conexão: ' + String(httpErr),
      })
    }

    if (!res || res.statusCode !== 200) {
      return e.json(res ? res.statusCode : 502, {
        success: false,
        status: 'external_error',
        message: 'Resposta externa HTTP ' + (res ? res.statusCode : 0),
      })
    }

    var body = res.json
    if (!body && res.raw) {
      try {
        body = JSON.parse(res.raw)
      } catch (_) {}
    }

    var items = []
    if (Array.isArray(body)) {
      items = body
    } else if (body && body.agendamentos && Array.isArray(body.agendamentos)) {
      items = body.agendamentos
    } else if (body && body.appointments && Array.isArray(body.appointments)) {
      items = body.appointments
    } else if (body && body.dados && Array.isArray(body.dados)) {
      items = body.dados
    }

    var appointmentsCol = $app.findCollectionByNameOrId('appointments')
    var pulled = 0

    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (!item || typeof item !== 'object') continue

      var rawStart = item.data_inicio || item.data_consulta || item.starts_at || item.data || ''
      if (!rawStart) continue

      var extId = String(item.id || item.external_id || '').trim()
      var patientName = String(
        item.patient_name || item.paciente_nome || item.nome || 'Paciente',
      ).trim()

      if (!extId) {
        extId = 'ext_' + $security.md5(patientName + '_' + String(rawStart))
      }

      var existing = null
      try {
        existing = $app.findFirstRecordByFilter(
          'appointments',
          'external_id = {:eid} && source = "agenda_externa"',
          { eid: extId },
        )
      } catch (_) {}

      var rec = existing || new Record(appointmentsCol)
      rec.set('source', 'agenda_externa')
      rec.set('external_id', extId)
      rec.set('patient_name', patientName)
      rec.set('patient_phone', item.patient_phone || item.paciente_telefone || item.telefone || '')
      rec.set('doctor', item.doctor || item.medico || 'Dr. Caio')
      rec.set('city', item.city || item.cidade || 'Carmo do Rio Claro')
      rec.set('location', item.location || item.local || 'Climed')

      var startsAtIso = String(rawStart)
      try {
        var d = new Date(startsAtIso)
        if (!isNaN(d.getTime())) {
          startsAtIso = d.toISOString()
        }
      } catch (_) {}

      rec.set('starts_at', startsAtIso)
      rec.set('status', item.status || 'agendado')
      rec.set('appointment_type', item.appointment_type || item.tipo_consulta || 'Consulta')
      rec.set('notes', item.notes || item.observacoes || '')
      rec.set('last_synced_at', new Date().toISOString())

      try {
        $app.save(rec)
        pulled++
      } catch (_) {}
    }

    return e.json(200, {
      success: true,
      status: 'success',
      message: 'Sincronização concluída com sucesso (' + pulled + ' registros)',
      pulled: pulled,
      pushed: 0,
      errors: [],
    })
  } catch (err) {
    return e.json(500, {
      success: false,
      status: 'internal_error',
      message: 'Erro interno: ' + String(err),
    })
  }
})

// 3. Rota GET de status e diagnóstico da sincronia
routerAdd('GET', '/backend/v1/agenda/sync-status', (e) => {
  try {
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var configured = Boolean(rawUrl)

    var total = 0
    try {
      total = $app.countRecords('appointments')
    } catch (_) {}

    return e.json(200, {
      configured: configured,
      sync_enabled: true,
      last_sync: new Date().toISOString(),
      last_status: configured ? 'success' : 'pending_credentials',
      last_error: null,
      counts: {
        total: total,
        agenda_externa: total,
        crm: 0,
        pending_push: 0,
        sync_errors: 0,
      },
    })
  } catch (err) {
    return e.json(500, { error: String(err) })
  }
})
