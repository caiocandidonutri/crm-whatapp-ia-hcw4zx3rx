/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIZAÇÃO DE AGENDA (SKIP CLOUD)
 * Hook seguro, fail-safe e leve com suporte a fetchWithRetry inline,
 * detecção de remoções/cancelamentos na agenda oficial (soft-cancel)
 * e atualização transparente de sync_state.
 *
 * NOTA DE ARQUITETURA JSVM POCKETBASE:
 * O JSVM do PocketBase executa callbacks em pools de VMs isoladas,
 * exigindo que todas as funções auxiliares sejam declaradas INLINE dentro de cada callback.
 */

// 1. Cron periódico de sincronização da agenda (a cada 30 min no minuto 12 e 42)
cronAdd('agenda_external_sync', '12,42 * * * *', () => {
  try {
    // Blindagem noturna (21h-07h de Brasília = UTC 00h-10h): evita requisições externas na madrugada
    var nMs = Date.now()
    var spD = new Date(nMs - 3 * 3600 * 1000)
    var hSp = spD.getUTCHours()
    if (hSp >= 21 || hSp < 7) {
      return
    }

    function fetchWithRetry(url, options) {
      var maxAttempts = 3
      var backoffs = [1000, 2000, 4000]
      var lastErr = null
      var lastRes = null

      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          var reqOpts = {
            url: url,
            method: (options && options.method) || 'GET',
            headers: (options && options.headers) || {},
            timeout: (options && options.timeout) || 5,
          }
          if (options && options.body) {
            reqOpts.body = options.body
          }

          var res = $http.send(reqOpts)
          if (res && res.statusCode >= 200 && res.statusCode < 300) {
            return { success: true, res: res, error: null }
          }
          lastRes = res
          lastErr = new Error('HTTP ' + (res ? res.statusCode : 0))
        } catch (err) {
          lastErr = err
        }

        if (attempt < maxAttempts) {
          var sleepMs = backoffs[attempt - 1] || 1000
          var startWait = Date.now()
          while (Date.now() - startWait < sleepMs) {
            // Pausa síncrona breve
          }
        }
      }

      return { success: false, res: lastRes, error: lastErr }
    }

    function updateSyncStateRecord(status, errorMsg, details) {
      try {
        var stateRec = null
        try {
          stateRec = $app.findFirstRecordByFilter(
            'sync_state',
            'key = "agenda_externa_dr_caio" || id = "xfyoa7n791cu701"',
          )
        } catch (_) {}

        if (!stateRec) {
          try {
            var col = $app.findCollectionByNameOrId('sync_state')
            stateRec = new Record(col)
            stateRec.set('key', 'agenda_externa_dr_caio')
          } catch (_) {
            return
          }
        }

        stateRec.set('last_status', status)
        stateRec.set('last_sync', new Date().toISOString())
        stateRec.set('last_error', errorMsg || '')
        if (details) {
          try {
            stateRec.set('details', typeof details === 'string' ? details : JSON.stringify(details))
          } catch (_) {}
        }
        $app.save(stateRec)
      } catch (err) {
        $app.logger().warn('agenda_sync: erro ao atualizar sync_state', 'error', String(err))
      }
    }

    function getAgendaSyncConfig() {
      var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
      var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
      var rawToken =
        ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
        'crm_agenda_token_dr_caio_2026'

      var baseUrl = rawUrl || RECOMMENDED_BASE_URL
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl
      }

      var qIdx = baseUrl.indexOf('?')
      var pathOnly = qIdx !== -1 ? baseUrl.slice(0, qIdx) : baseUrl
      if (pathOnly.endsWith('/')) {
        pathOnly = pathOnly.slice(0, -1)
      }

      var pullUrl = ''
      if (pathOnly.indexOf('/backend/v1/crm-dados') !== -1) {
        pullUrl = baseUrl
      } else {
        pullUrl = pathOnly + '/backend/v1/crm-dados?tipo=tudo'
      }

      return {
        rawUrl: rawUrl,
        pullUrl: pullUrl,
        token: rawToken,
      }
    }

    function processSyncItems(body, resolvedAccountId) {
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

      var pulledCount = 0
      var returnedExternalIds = {}

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

        returnedExternalIds[extId] = item

        var itemPhone = String(
          item.patient_phone || item.paciente_telefone || item.telefone || '',
        ).trim()
        var itemPhoneDigits = cleanDigits(itemPhone)
        var itemPhoneSuffix = itemPhoneDigits.length >= 8 ? itemPhoneDigits.slice(-8) : ''

        var existing = null
        try {
          existing = $app.findFirstRecordByFilter(
            'appointments',
            'external_id = {:eid} && source = "agenda_externa"',
            { eid: extId },
          )
        } catch (_) {}

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

        var existingStatus = rec.getString('status')
        var newStatus = item.status || 'agendado'
        if (newStatus === 'cancelado') {
          rec.set('status', 'cancelado')
          if (!rec.getString('notes')) {
            rec.set('notes', 'Cancelado na agenda oficial')
          }
        } else if (
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

        if (
          resolvedAccountId &&
          (!rec.getString('account_id') || rec.getString('account_id') !== resolvedAccountId)
        ) {
          rec.set('account_id', resolvedAccountId)
        }

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
          pulledCount++
        } catch (_) {}
      }

      // Soft-cancel de ausentes na oficial (-60 a +60 dias)
      var softCancelledCount = 0
      try {
        var nowUtc = Date.now()
        var windowStartIso = new Date(nowUtc - 60 * 24 * 3600 * 1000).toISOString()
        var windowEndIso = new Date(nowUtc + 60 * 24 * 3600 * 1000).toISOString()

        var localAppts = $app.findRecordsByFilter(
          'appointments',
          'source = "agenda_externa" && external_id != "" && status != "cancelado" && starts_at >= {:wStart} && starts_at <= {:wEnd}',
          'starts_at',
          500,
          0,
          { wStart: windowStartIso, wEnd: windowEndIso },
        )

        for (var j = 0; j < localAppts.length; j++) {
          var localRec = localAppts[j]
          var localExtId = localRec.getString('external_id')
          if (!localExtId) continue

          var remoteItem = returnedExternalIds[localExtId]
          var shouldSoftCancel = false
          var reason = ''

          if (!remoteItem) {
            shouldSoftCancel = true
            reason = 'Cancelado/removido na agenda oficial'
          } else if (remoteItem.status === 'cancelado') {
            shouldSoftCancel = true
            reason = 'Cancelado na agenda oficial'
          }

          if (shouldSoftCancel) {
            localRec.set('status', 'cancelado')
            var currentNotes = localRec.getString('notes')
            if (currentNotes) {
              if (currentNotes.indexOf(reason) === -1) {
                localRec.set('notes', currentNotes + ' (' + reason + ')')
              }
            } else {
              localRec.set('notes', reason)
            }
            localRec.set('last_synced_at', new Date().toISOString())
            try {
              $app.saveNoValidate(localRec)
              softCancelledCount++
            } catch (_) {}
          }
        }
      } catch (errCancel) {
        $app
          .logger()
          .warn('agenda_sync: erro durante varredura de soft-cancel', 'error', String(errCancel))
      }

      return { pulled: pulledCount, softCancelled: softCancelledCount }
    }

    var cfg = getAgendaSyncConfig()
    var headers = {
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
      Authorization: 'Bearer ' + cfg.token,
    }

    var fetchResult = fetchWithRetry(cfg.pullUrl, {
      method: 'GET',
      headers: headers,
      timeout: 5,
    })

    if (!fetchResult.success || !fetchResult.res || fetchResult.res.statusCode !== 200) {
      var errStr = fetchResult.error
        ? String(fetchResult.error)
        : 'HTTP ' + (fetchResult.res ? fetchResult.res.statusCode : 0)
      $app.logger().error('agenda_external_sync retry failed', 'error', errStr)
      updateSyncStateRecord('connection_error', errStr, { pull_url: cfg.pullUrl })
      return
    }

    var res = fetchResult.res
    var body = res.json
    if (!body && res.raw) {
      try {
        body = JSON.parse(res.raw)
      } catch (_) {}
    }

    if (!body) {
      updateSyncStateRecord('empty_response', 'Resposta vazia da agenda externa', {
        pull_url: cfg.pullUrl,
      })
      return
    }

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

    var syncOutcome = processSyncItems(body, resolvedAccountId)

    updateSyncStateRecord('ok', '', {
      pull_url: cfg.pullUrl,
      pulled: syncOutcome.pulled,
      soft_cancelled: syncOutcome.softCancelled,
    })

    $app
      .logger()
      .info(
        'agenda_external_sync concluído com sucesso',
        'pulled',
        syncOutcome.pulled,
        'soft_cancelled',
        syncOutcome.softCancelled,
      )
  } catch (fatalErr) {
    $app.logger().error('agenda_external_sync fatal error', 'error', String(fatalErr))
  }
})

// 2. Rota POST para sincronização manual acionada pelo usuário na tela da agenda
routerAdd('POST', '/backend/v1/agenda/sync', (e) => {
  try {
    function fetchWithRetry(url, options) {
      var maxAttempts = 3
      var backoffs = [1000, 2000, 4000]
      var lastErr = null
      var lastRes = null

      for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          var reqOpts = {
            url: url,
            method: (options && options.method) || 'GET',
            headers: (options && options.headers) || {},
            timeout: (options && options.timeout) || 5,
          }
          if (options && options.body) {
            reqOpts.body = options.body
          }

          var res = $http.send(reqOpts)
          if (res && res.statusCode >= 200 && res.statusCode < 300) {
            return { success: true, res: res, error: null }
          }
          lastRes = res
          lastErr = new Error('HTTP ' + (res ? res.statusCode : 0))
        } catch (err) {
          lastErr = err
        }

        if (attempt < maxAttempts) {
          var sleepMs = backoffs[attempt - 1] || 1000
          var startWait = Date.now()
          while (Date.now() - startWait < sleepMs) {
            // Pausa síncrona
          }
        }
      }

      return { success: false, res: lastRes, error: lastErr }
    }

    function updateSyncStateRecord(status, errorMsg, details) {
      try {
        var stateRec = null
        try {
          stateRec = $app.findFirstRecordByFilter(
            'sync_state',
            'key = "agenda_externa_dr_caio" || id = "xfyoa7n791cu701"',
          )
        } catch (_) {}

        if (!stateRec) {
          try {
            var col = $app.findCollectionByNameOrId('sync_state')
            stateRec = new Record(col)
            stateRec.set('key', 'agenda_externa_dr_caio')
          } catch (_) {
            return
          }
        }

        stateRec.set('last_status', status)
        stateRec.set('last_sync', new Date().toISOString())
        stateRec.set('last_error', errorMsg || '')
        if (details) {
          try {
            stateRec.set('details', typeof details === 'string' ? details : JSON.stringify(details))
          } catch (_) {}
        }
        $app.save(stateRec)
      } catch (err) {
        $app.logger().warn('agenda_sync: erro ao atualizar sync_state', 'error', String(err))
      }
    }

    function getAgendaSyncConfig() {
      var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
      var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
      var rawToken =
        ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
        'crm_agenda_token_dr_caio_2026'

      var baseUrl = rawUrl || RECOMMENDED_BASE_URL
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'https://' + baseUrl
      }

      var qIdx = baseUrl.indexOf('?')
      var pathOnly = qIdx !== -1 ? baseUrl.slice(0, qIdx) : baseUrl
      if (pathOnly.endsWith('/')) {
        pathOnly = pathOnly.slice(0, -1)
      }

      var pullUrl = ''
      if (pathOnly.indexOf('/backend/v1/crm-dados') !== -1) {
        pullUrl = baseUrl
      } else {
        pullUrl = pathOnly + '/backend/v1/crm-dados?tipo=tudo'
      }

      return {
        rawUrl: rawUrl,
        pullUrl: pullUrl,
        token: rawToken,
      }
    }

    function processSyncItems(body, resolvedAccountId) {
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

      var pulledCount = 0
      var returnedExternalIds = {}

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

        returnedExternalIds[extId] = item

        var itemPhone = String(
          item.patient_phone || item.paciente_telefone || item.telefone || '',
        ).trim()
        var itemPhoneDigits = cleanDigits(itemPhone)
        var itemPhoneSuffix = itemPhoneDigits.length >= 8 ? itemPhoneDigits.slice(-8) : ''

        var existing = null
        try {
          existing = $app.findFirstRecordByFilter(
            'appointments',
            'external_id = {:eid} && source = "agenda_externa"',
            { eid: extId },
          )
        } catch (_) {}

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

        var existingStatus = rec.getString('status')
        var newStatus = item.status || 'agendado'
        if (newStatus === 'cancelado') {
          rec.set('status', 'cancelado')
          if (!rec.getString('notes')) {
            rec.set('notes', 'Cancelado na agenda oficial')
          }
        } else if (
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

        if (
          resolvedAccountId &&
          (!rec.getString('account_id') || rec.getString('account_id') !== resolvedAccountId)
        ) {
          rec.set('account_id', resolvedAccountId)
        }

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
          pulledCount++
        } catch (_) {}
      }

      var softCancelledCount = 0
      try {
        var nowUtc = Date.now()
        var windowStartIso = new Date(nowUtc - 60 * 24 * 3600 * 1000).toISOString()
        var windowEndIso = new Date(nowUtc + 60 * 24 * 3600 * 1000).toISOString()

        var localAppts = $app.findRecordsByFilter(
          'appointments',
          'source = "agenda_externa" && external_id != "" && status != "cancelado" && starts_at >= {:wStart} && starts_at <= {:wEnd}',
          'starts_at',
          500,
          0,
          { wStart: windowStartIso, wEnd: windowEndIso },
        )

        for (var j = 0; j < localAppts.length; j++) {
          var localRec = localAppts[j]
          var localExtId = localRec.getString('external_id')
          if (!localExtId) continue

          var remoteItem = returnedExternalIds[localExtId]
          var shouldSoftCancel = false
          var reason = ''

          if (!remoteItem) {
            shouldSoftCancel = true
            reason = 'Cancelado/removido na agenda oficial'
          } else if (remoteItem.status === 'cancelado') {
            shouldSoftCancel = true
            reason = 'Cancelado na agenda oficial'
          }

          if (shouldSoftCancel) {
            localRec.set('status', 'cancelado')
            var currentNotes = localRec.getString('notes')
            if (currentNotes) {
              if (currentNotes.indexOf(reason) === -1) {
                localRec.set('notes', currentNotes + ' (' + reason + ')')
              }
            } else {
              localRec.set('notes', reason)
            }
            localRec.set('last_synced_at', new Date().toISOString())
            try {
              $app.saveNoValidate(localRec)
              softCancelledCount++
            } catch (_) {}
          }
        }
      } catch (errCancel) {
        $app
          .logger()
          .warn('agenda_sync: erro durante varredura de soft-cancel', 'error', String(errCancel))
      }

      return { pulled: pulledCount, softCancelled: softCancelledCount }
    }

    var cfg = getAgendaSyncConfig()
    var headers = {
      Accept: 'application/json',
      'X-CRM-Token': cfg.token,
      Authorization: 'Bearer ' + cfg.token,
    }

    var fetchResult = fetchWithRetry(cfg.pullUrl, {
      method: 'GET',
      headers: headers,
      timeout: 5,
    })

    if (!fetchResult.success || !fetchResult.res || fetchResult.res.statusCode !== 200) {
      var errStr = fetchResult.error
        ? String(fetchResult.error)
        : 'HTTP ' + (fetchResult.res ? fetchResult.res.statusCode : 0)
      updateSyncStateRecord('connection_error', errStr, { pull_url: cfg.pullUrl })
      return e.json(502, {
        success: false,
        status: 'connection_error',
        message: 'Falha de conexão com a agenda externa: ' + errStr,
      })
    }

    var res = fetchResult.res
    var body = res.json
    if (!body && res.raw) {
      try {
        body = JSON.parse(res.raw)
      } catch (_) {}
    }

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

    var syncOutcome = processSyncItems(body, resolvedAccountId)

    updateSyncStateRecord('ok', '', {
      pull_url: cfg.pullUrl,
      pulled: syncOutcome.pulled,
      soft_cancelled: syncOutcome.softCancelled,
    })

    return e.json(200, {
      success: true,
      status: 'ok',
      message:
        'Sincronização concluída com sucesso (' +
        syncOutcome.pulled +
        ' atualizados, ' +
        syncOutcome.softCancelled +
        ' cancelados)',
      pulled: syncOutcome.pulled,
      soft_cancelled: syncOutcome.softCancelled,
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

// 3. Rota GET de status e diagnóstico da sincronia: lê o registro real da coleção sync_state
routerAdd('GET', '/backend/v1/agenda/sync-status', (e) => {
  try {
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var configured = Boolean(rawUrl)

    var stateRec = null
    try {
      stateRec = $app.findFirstRecordByFilter(
        'sync_state',
        'key = "agenda_externa_dr_caio" || id = "xfyoa7n791cu701"',
      )
    } catch (_) {}

    var total = 0
    var pendingPush = 0
    try {
      total = $app.countRecords('appointments')
    } catch (_) {}
    try {
      pendingPush = $app.countRecords('appointments', 'source = "crm" && sync_error != ""')
    } catch (_) {}

    var lastSync = stateRec ? stateRec.getString('last_sync') : new Date().toISOString()
    var lastStatus = stateRec
      ? stateRec.getString('last_status')
      : configured
        ? 'ok'
        : 'pending_credentials'
    var lastError = stateRec ? stateRec.getString('last_error') : ''

    return e.json(200, {
      configured: configured,
      sync_enabled: true,
      last_sync: lastSync,
      last_status: lastStatus,
      last_error: lastError || null,
      total_appointments: total,
      pending_push: pendingPush,
      counts: {
        total: total,
        agenda_externa: total,
        crm: 0,
        pending_push: pendingPush,
        sync_errors: pendingPush,
      },
    })
  } catch (err) {
    return e.json(500, { error: String(err) })
  }
})
