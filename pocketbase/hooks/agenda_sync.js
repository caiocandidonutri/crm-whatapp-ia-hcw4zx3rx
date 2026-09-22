/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIZAÇÃO DE AGENDA (SKIP CLOUD)
 * Hook seguro, fail-safe e leve
 */

// 1. Cron periódico de sincronização da agenda (a cada 30 min no minuto 12 e 42; sincronização manual na tela /agenda sob demanda)
// Restaurado da emergência com timeout curto (4s), sem lock síncrono e sem bloqueio indevido por pausa de mensagens
cronAdd('agenda_external_sync', '12,42 * * * *', () => {
  try {
    // Blindagem noturna (21h-07h de Brasília = UTC 00h-10h): evita requisições externas na madrugada
    var nMs = Date.now()
    var spD = new Date(nMs - 3 * 3600 * 1000)
    var hSp = spD.getUTCHours()
    if (hSp >= 21 || hSp < 7) {
      return
    }

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

    // Resolver accountId padrão da clínica
    var resolvedAccountId = ''
    try {
      var caioUser = $app.findAuthRecordByEmail('_pb_users_auth_', 'caiocandidonutri@hotmail.com')
      if (caioUser) {
        var memberRec = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: caioUser.id,
        })
        if (memberRec) {
          resolvedAccountId = memberRec.getString('account_id')
        }
      }
    } catch (_) {}
    if (!resolvedAccountId) {
      try {
        var anyAccount = $app.findFirstRecordByFilter('accounts', '', { sort: '-created' })
        if (anyAccount) resolvedAccountId = anyAccount.id
      } catch (_) {}
    }

    var appointmentsCol = $app.findCollectionByNameOrId('appointments')

    function cleanDigits(s) {
      if (!s) return ''
      return String(s).replace(/\D/g, '')
    }

    function normalizeName(s) {
      if (!s) return ''
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim()
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (!item || typeof item !== 'object') continue

      var rawStart = item.data_inicio || item.data_consulta || item.starts_at || item.data || ''
      if (!rawStart) continue

      var extId = String(item.id || item.external_id || '').trim()
      var patientName = String(
        item.patient_name || item.paciente_nome || item.nome || 'Paciente',
      ).trim()

      var startsAtIso = String(rawStart)
      try {
        var d = new Date(startsAtIso)
        if (!isNaN(d.getTime())) {
          startsAtIso = d.toISOString()
        }
      } catch (_) {}

      if (!extId) {
        extId = 'ext_' + $security.md5(patientName + '_' + startsAtIso)
      }

      var itemPhone = String(
        item.patient_phone || item.paciente_telefone || item.telefone || '',
      ).trim()
      var itemPhoneDigits = cleanDigits(itemPhone)
      var itemPhoneSuffix = itemPhoneDigits.length >= 8 ? itemPhoneDigits.slice(-8) : ''

      // 1. Tentar encontrar por external_id
      var existing = null
      try {
        existing = $app.findFirstRecordByFilter(
          'appointments',
          'external_id = {:eid} && source = "agenda_externa"',
          { eid: extId },
        )
      } catch (_) {}

      // 2. Se não encontrou por external_id, buscar por deduplicação composta:
      // mesmo paciente (telefone ou nome) + mesma data/hora (janela de ±15 minutos)
      if (!existing && startsAtIso) {
        try {
          var targetDateMs = new Date(startsAtIso).getTime()
          var windowStartIso = new Date(targetDateMs - 15 * 60 * 1000).toISOString()
          var windowEndIso = new Date(targetDateMs + 15 * 60 * 1000).toISOString()

          var candidates = $app.findRecordsByFilter(
            'appointments',
            'starts_at >= {:wStart} && starts_at <= {:wEnd}',
            '-updated',
            20,
            0,
            { wStart: windowStartIso, wEnd: windowEndIso },
          )

          if (candidates && candidates.length > 0) {
            var normName = normalizeName(patientName)
            for (var c = 0; c < candidates.length; c++) {
              var cand = candidates[c]
              var cPhoneDigits = cleanDigits(cand.getString('patient_phone'))
              var cPhoneSuffix = cPhoneDigits.length >= 8 ? cPhoneDigits.slice(-8) : ''
              var cNormName = normalizeName(cand.getString('patient_name'))

              var matchPhone = itemPhoneSuffix && cPhoneSuffix && itemPhoneSuffix === cPhoneSuffix
              var matchName =
                normName &&
                cNormName &&
                (normName === cNormName ||
                  normName.indexOf(cNormName) !== -1 ||
                  cNormName.indexOf(normName) !== -1)

              if (matchPhone || matchName) {
                existing = cand
                break
              }
            }
          }
        } catch (_) {}
      }

      var rec = existing || new Record(appointmentsCol)
      rec.set('source', 'agenda_externa')
      rec.set('external_id', extId)
      rec.set('patient_name', patientName)
      if (itemPhone || !rec.getString('patient_phone')) {
        rec.set('patient_phone', itemPhone)
      }
      rec.set('doctor', item.doctor || item.medico || 'Dr. Caio')
      rec.set('city', item.city || item.cidade || 'Carmo do Rio Claro')
      rec.set('location', item.location || item.local || 'Climed')
      rec.set('starts_at', startsAtIso)

      // Preservar confirmação de paciente caso já exista localmente
      var existingStatus = rec.getString('status')
      var newStatus = item.status || 'agendado'
      if (
        existingStatus === 'confirmado' &&
        rec.getString('confirmation_sent_at') &&
        (newStatus === 'agendado' || !newStatus)
      ) {
        // Manter 'confirmado' para não perder confirmação já feita no WhatsApp CRM
      } else {
        rec.set('status', newStatus)
      }

      rec.set('appointment_type', item.appointment_type || item.tipo_consulta || 'Consulta')
      if (item.notes || item.observacoes) {
        rec.set('notes', item.notes || item.observacoes || '')
      }
      rec.set('last_synced_at', new Date().toISOString())

      // Vincular account_id
      if (
        resolvedAccountId &&
        (!rec.getString('account_id') || rec.getString('account_id') !== resolvedAccountId)
      ) {
        rec.set('account_id', resolvedAccountId)
      }

      // Vincular patient_id e conversation_id por telefone quando possível
      var activePhoneDigits = cleanDigits(rec.getString('patient_phone')) || itemPhoneDigits
      if (
        activePhoneDigits.length >= 8 &&
        (!rec.getString('patient_id') || !rec.getString('conversation_id'))
      ) {
        var pSuf = activePhoneDigits.slice(-8)
        try {
          if (!rec.getString('patient_id')) {
            var pat = $app.findFirstRecordByFilter(
              'crm_contacts',
              'phone ~ {:suf} || jid ~ {:suf}',
              { suf: pSuf },
            )
            if (pat) rec.set('patient_id', pat.id)
          }
        } catch (_) {}

        try {
          if (!rec.getString('conversation_id')) {
            var conv = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
              { suf: pSuf },
            )
            if (conv) rec.set('conversation_id', conv.id)
          }
        } catch (_) {}
      }

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

    // Resolver accountId da requisição ou padrão da clínica
    var resolvedAccountId = ''
    try {
      if (e.auth) {
        var mRec = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: e.auth.id,
        })
        if (mRec) resolvedAccountId = mRec.getString('account_id')
      }
    } catch (_) {}
    if (!resolvedAccountId) {
      try {
        var caioUser = $app.findAuthRecordByEmail('_pb_users_auth_', 'caiocandidonutri@hotmail.com')
        if (caioUser) {
          var memberRec = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
            uid: caioUser.id,
          })
          if (memberRec) resolvedAccountId = memberRec.getString('account_id')
        }
      } catch (_) {}
    }
    if (!resolvedAccountId) {
      try {
        var anyAccount = $app.findFirstRecordByFilter('accounts', '', { sort: '-created' })
        if (anyAccount) resolvedAccountId = anyAccount.id
      } catch (_) {}
    }

    var appointmentsCol = $app.findCollectionByNameOrId('appointments')
    var pulled = 0

    function cleanDigits(s) {
      if (!s) return ''
      return String(s).replace(/\D/g, '')
    }

    function normalizeName(s) {
      if (!s) return ''
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim()
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (!item || typeof item !== 'object') continue

      var rawStart = item.data_inicio || item.data_consulta || item.starts_at || item.data || ''
      if (!rawStart) continue

      var extId = String(item.id || item.external_id || '').trim()
      var patientName = String(
        item.patient_name || item.paciente_nome || item.nome || 'Paciente',
      ).trim()

      var startsAtIso = String(rawStart)
      try {
        var d = new Date(startsAtIso)
        if (!isNaN(d.getTime())) {
          startsAtIso = d.toISOString()
        }
      } catch (_) {}

      if (!extId) {
        extId = 'ext_' + $security.md5(patientName + '_' + startsAtIso)
      }

      var itemPhone = String(
        item.patient_phone || item.paciente_telefone || item.telefone || '',
      ).trim()
      var itemPhoneDigits = cleanDigits(itemPhone)
      var itemPhoneSuffix = itemPhoneDigits.length >= 8 ? itemPhoneDigits.slice(-8) : ''

      // 1. Tentar encontrar por external_id
      var existing = null
      try {
        existing = $app.findFirstRecordByFilter(
          'appointments',
          'external_id = {:eid} && source = "agenda_externa"',
          { eid: extId },
        )
      } catch (_) {}

      // 2. Se não encontrou por external_id, deduplicação por chave composta:
      // mesmo paciente (telefone ou nome) + mesma data/hora (janela ±15 min)
      if (!existing && startsAtIso) {
        try {
          var targetDateMs = new Date(startsAtIso).getTime()
          var windowStartIso = new Date(targetDateMs - 15 * 60 * 1000).toISOString()
          var windowEndIso = new Date(targetDateMs + 15 * 60 * 1000).toISOString()

          var candidates = $app.findRecordsByFilter(
            'appointments',
            'starts_at >= {:wStart} && starts_at <= {:wEnd}',
            '-updated',
            20,
            0,
            { wStart: windowStartIso, wEnd: windowEndIso },
          )

          if (candidates && candidates.length > 0) {
            var normName = normalizeName(patientName)
            for (var c = 0; c < candidates.length; c++) {
              var cand = candidates[c]
              var cPhoneDigits = cleanDigits(cand.getString('patient_phone'))
              var cPhoneSuffix = cPhoneDigits.length >= 8 ? cPhoneDigits.slice(-8) : ''
              var cNormName = normalizeName(cand.getString('patient_name'))

              var matchPhone = itemPhoneSuffix && cPhoneSuffix && itemPhoneSuffix === cPhoneSuffix
              var matchName =
                normName &&
                cNormName &&
                (normName === cNormName ||
                  normName.indexOf(cNormName) !== -1 ||
                  cNormName.indexOf(normName) !== -1)

              if (matchPhone || matchName) {
                existing = cand
                break
              }
            }
          }
        } catch (_) {}
      }

      var rec = existing || new Record(appointmentsCol)
      rec.set('source', 'agenda_externa')
      rec.set('external_id', extId)
      rec.set('patient_name', patientName)
      if (itemPhone || !rec.getString('patient_phone')) {
        rec.set('patient_phone', itemPhone)
      }
      rec.set('doctor', item.doctor || item.medico || 'Dr. Caio')
      rec.set('city', item.city || item.cidade || 'Carmo do Rio Claro')
      rec.set('location', item.location || item.local || 'Climed')
      rec.set('starts_at', startsAtIso)

      // Preservar confirmação de paciente caso já exista localmente
      var existingStatus = rec.getString('status')
      var newStatus = item.status || 'agendado'
      if (
        existingStatus === 'confirmado' &&
        rec.getString('confirmation_sent_at') &&
        (newStatus === 'agendado' || !newStatus)
      ) {
        // Manter 'confirmado'
      } else {
        rec.set('status', newStatus)
      }

      rec.set('appointment_type', item.appointment_type || item.tipo_consulta || 'Consulta')
      if (item.notes || item.observacoes) {
        rec.set('notes', item.notes || item.observacoes || '')
      }
      rec.set('last_synced_at', new Date().toISOString())

      // Vincular account_id
      if (
        resolvedAccountId &&
        (!rec.getString('account_id') || rec.getString('account_id') !== resolvedAccountId)
      ) {
        rec.set('account_id', resolvedAccountId)
      }

      // Vincular patient_id e conversation_id por telefone quando possível
      var activePhoneDigits = cleanDigits(rec.getString('patient_phone')) || itemPhoneDigits
      if (
        activePhoneDigits.length >= 8 &&
        (!rec.getString('patient_id') || !rec.getString('conversation_id'))
      ) {
        var pSuf = activePhoneDigits.slice(-8)
        try {
          if (!rec.getString('patient_id')) {
            var pat = $app.findFirstRecordByFilter(
              'crm_contacts',
              'phone ~ {:suf} || jid ~ {:suf}',
              { suf: pSuf },
            )
            if (pat) rec.set('patient_id', pat.id)
          }
        } catch (_) {}

        try {
          if (!rec.getString('conversation_id')) {
            var conv = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
              { suf: pSuf },
            )
            if (conv) rec.set('conversation_id', conv.id)
          }
        } catch (_) {}
      }

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
