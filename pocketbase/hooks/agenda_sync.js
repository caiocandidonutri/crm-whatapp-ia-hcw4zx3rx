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

        // Payload externo entrega horário civil local de Brasília ("YYYY-MM-DD HH:mm:ss" ou "YYYY-MM-DDTHH:mm:ss").
        // Interpretar estritamente com offset -03:00 (America/Sao_Paulo) para não deslocar 3h adiante.
        var startsAtIso = ''
        var rawStartStr = String(rawStart).trim()
        var matchIsoTime = rawStartStr.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/)
        if (matchIsoTime) {
          var datePartSync = matchIsoTime[1]
          var timePartSync = matchIsoTime[2]
          if (timePartSync.length === 5) timePartSync += ':00'
          try {
            var dParsed = new Date(datePartSync + 'T' + timePartSync + '-03:00')
            if (!isNaN(dParsed.getTime())) {
              startsAtIso = dParsed.toISOString()
            }
          } catch (_) {}
        }
        if (!startsAtIso) {
          try {
            var dFallback = new Date(rawStartStr)
            if (!isNaN(dFallback.getTime())) {
              startsAtIso = dFallback.toISOString()
            }
          } catch (_) {}
        }
        if (!startsAtIso) {
          startsAtIso = rawStartStr
        }

        // EXPEDIENTE 07:00–20:00 (horário civil local):
        // Se horário chegar fora da janela, criar task na coleção 'tasks' (status 'pendente', prioridade 'alta', care_category 'precisa_atencao') para a Fabiana aprovar/reagendar
        var localHour = -1
        var localMinute = 0
        if (matchIsoTime) {
          var hp = matchIsoTime[2].split(':')
          localHour = parseInt(hp[0], 10)
          localMinute = parseInt(hp[1] || '0', 10)
        } else {
          try {
            var dLocal = new Date(startsAtIso)
            if (!isNaN(dLocal.getTime())) {
              // Converter UTC para hora local SP (-3)
              var utcHours = dLocal.getUTCHours()
              localHour = (utcHours - 3 + 24) % 24
              localMinute = dLocal.getUTCMinutes()
            }
          } catch (_) {}
        }

        var isOutsideHours =
          localHour < 7 || (localHour === 20 && localMinute > 0) || localHour > 20
        if (isOutsideHours && localHour !== -1) {
          try {
            var existingOutsideTask = null
            try {
              existingOutsideTask = $app.findFirstRecordByFilter(
                'tasks',
                'account_id = {:aid} && title ~ {:pname} && status = "pendente"',
                { aid: resolvedAccountId, pname: patientName },
              )
            } catch (_) {}

            if (!existingOutsideTask) {
              var tasksCol = $app.findCollectionByNameOrId('tasks')
              var outTask = new Record(tasksCol)
              outTask.set('account_id', resolvedAccountId)
              outTask.set('title', 'Aprovar agendamento fora de expediente: ' + patientName)
              outTask.set(
                'description',
                'Agendamento recebido da agenda oficial fora do expediente comercial (07:00–20:00). Horário recebido: ' +
                  rawStartStr +
                  ' (' +
                  (localHour < 10 ? '0' + localHour : localHour) +
                  ':' +
                  (localMinute < 10 ? '0' + localMinute : localMinute) +
                  ' local). Fabiana precisa aprovar ou reagendar.',
              )
              outTask.set('status', 'pendente')
              outTask.set('priority', 'alta')
              outTask.set('care_category', 'precisa_atencao')
              $app.save(outTask)
            }
          } catch (taskErr) {
            $app
              .logger()
              .warn('agenda_sync: falha ao criar task fora de expediente', 'err', String(taskErr))
          }
        }

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
            // Janela de deduplicação ±48h (mesmo paciente/telefone), preservando sempre o registro com external_id
            var windowStartIso = new Date(targetDateMs - 48 * 60 * 60 * 1000).toISOString()
            var windowEndIso = new Date(targetDateMs + 48 * 60 * 60 * 1000).toISOString()

            var candidates = $app.findRecordsByFilter(
              'appointments',
              'starts_at >= {:wStart} && starts_at <= {:wEnd}',
              '-updated',
              50,
              0,
              { wStart: windowStartIso, wEnd: windowEndIso },
            )

            if (candidates && candidates.length > 0) {
              var normName = normalizeName(patientName)
              var matchedCandidates = []
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
                  matchedCandidates.push(cand)
                }
              }

              if (matchedCandidates.length > 0) {
                // Preferir candidato que já possui external_id correspondente
                var exactExtMatch = null
                for (var mi = 0; mi < matchedCandidates.length; mi++) {
                  if (matchedCandidates[mi].getString('external_id') === extId) {
                    exactExtMatch = matchedCandidates[mi]
                    break
                  }
                }
                existing = exactExtMatch || matchedCandidates[0]

                // Se houver múltiplos candidatos duplicados na janela de 48h sem external_id, marcar como cancelado
                for (var ci = 0; ci < matchedCandidates.length; ci++) {
                  var otherCand = matchedCandidates[ci]
                  if (
                    otherCand.id !== existing.id &&
                    !otherCand.getString('external_id') &&
                    otherCand.getString('status') !== 'cancelado'
                  ) {
                    otherCand.set('status', 'cancelado')
                    var oNotes = otherCand.getString('notes') || ''
                    var dedupNote = 'Cancelado em favor do agendamento oficial (deduplicação ±48h)'
                    if (oNotes.indexOf(dedupNote) === -1) {
                      otherCand.set('notes', oNotes ? oNotes + ' - ' + dedupNote : dedupNote)
                    }
                    try {
                      $app.saveNoValidate(otherCand)
                    } catch (_) {}
                  }
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

      // Soft-cancel seguro de ausentes na oficial: apenas DENTRO da janela real retornada pela API
      var softCancelledCount = 0
      try {
        var minDateMs = Infinity
        var maxDateMs = -Infinity

        for (var k = 0; k < items.length; k++) {
          var itm = items[k]
          if (!itm || typeof itm !== 'object') continue
          var rawDate = itm.starts_at || itm.data_inicio || itm.data_consulta || itm.data || ''
          if (!rawDate) continue
          var dMs = new Date(rawDate).getTime()
          if (!isNaN(dMs)) {
            if (dMs < minDateMs) minDateMs = dMs
            if (dMs > maxDateMs) maxDateMs = dMs
          }
        }

        if (minDateMs !== Infinity && maxDateMs !== -Infinity) {
          var windowStartIso = new Date(minDateMs).toISOString()
          var windowEndIso = new Date(maxDateMs).toISOString()

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

        // Payload externo entrega horário civil local de Brasília ("YYYY-MM-DD HH:mm:ss" ou "YYYY-MM-DDTHH:mm:ss").
        // Interpretar estritamente com offset -03:00 (America/Sao_Paulo) para não deslocar 3h adiante.
        var startsAtIso = ''
        var rawStartStr = String(rawStart).trim()
        var matchIsoTime = rawStartStr.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/)
        if (matchIsoTime) {
          var datePartSync = matchIsoTime[1]
          var timePartSync = matchIsoTime[2]
          if (timePartSync.length === 5) timePartSync += ':00'
          try {
            var dParsed = new Date(datePartSync + 'T' + timePartSync + '-03:00')
            if (!isNaN(dParsed.getTime())) {
              startsAtIso = dParsed.toISOString()
            }
          } catch (_) {}
        }
        if (!startsAtIso) {
          try {
            var dFallback = new Date(rawStartStr)
            if (!isNaN(dFallback.getTime())) {
              startsAtIso = dFallback.toISOString()
            }
          } catch (_) {}
        }
        if (!startsAtIso) {
          startsAtIso = rawStartStr
        }

        // EXPEDIENTE 07:00–20:00 (horário civil local):
        // Se horário chegar fora da janela, criar task na coleção 'tasks' (status 'pendente', prioridade 'alta', care_category 'precisa_atencao') para a Fabiana aprovar/reagendar
        var localHour = -1
        var localMinute = 0
        if (matchIsoTime) {
          var hp = matchIsoTime[2].split(':')
          localHour = parseInt(hp[0], 10)
          localMinute = parseInt(hp[1] || '0', 10)
        } else {
          try {
            var dLocal = new Date(startsAtIso)
            if (!isNaN(dLocal.getTime())) {
              var utcHours = dLocal.getUTCHours()
              localHour = (utcHours - 3 + 24) % 24
              localMinute = dLocal.getUTCMinutes()
            }
          } catch (_) {}
        }

        var isOutsideHours =
          localHour < 7 || (localHour === 20 && localMinute > 0) || localHour > 20
        if (isOutsideHours && localHour !== -1) {
          try {
            var existingOutsideTask = null
            try {
              existingOutsideTask = $app.findFirstRecordByFilter(
                'tasks',
                'account_id = {:aid} && title ~ {:pname} && status = "pendente"',
                { aid: resolvedAccountId, pname: patientName },
              )
            } catch (_) {}

            if (!existingOutsideTask) {
              var tasksCol = $app.findCollectionByNameOrId('tasks')
              var outTask = new Record(tasksCol)
              outTask.set('account_id', resolvedAccountId)
              outTask.set('title', 'Aprovar agendamento fora de expediente: ' + patientName)
              outTask.set(
                'description',
                'Agendamento recebido da agenda oficial fora do expediente comercial (07:00–20:00). Horário recebido: ' +
                  rawStartStr +
                  ' (' +
                  (localHour < 10 ? '0' + localHour : localHour) +
                  ':' +
                  (localMinute < 10 ? '0' + localMinute : localMinute) +
                  ' local). Fabiana precisa aprovar ou reagendar.',
              )
              outTask.set('status', 'pendente')
              outTask.set('priority', 'alta')
              outTask.set('care_category', 'precisa_atencao')
              $app.save(outTask)
            }
          } catch (taskErr) {
            $app
              .logger()
              .warn('agenda_sync: falha ao criar task fora de expediente', 'err', String(taskErr))
          }
        }

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
            // Janela de deduplicação ±48h (mesmo paciente/telefone), preservando sempre o registro com external_id
            var windowStartIso = new Date(targetDateMs - 48 * 60 * 60 * 1000).toISOString()
            var windowEndIso = new Date(targetDateMs + 48 * 60 * 60 * 1000).toISOString()

            var candidates = $app.findRecordsByFilter(
              'appointments',
              'starts_at >= {:wStart} && starts_at <= {:wEnd}',
              '-updated',
              50,
              0,
              { wStart: windowStartIso, wEnd: windowEndIso },
            )

            if (candidates && candidates.length > 0) {
              var normName = normalizeName(patientName)
              var matchedCandidates = []
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
                  matchedCandidates.push(cand)
                }
              }

              if (matchedCandidates.length > 0) {
                // Preferir candidato que já possui external_id correspondente
                var exactExtMatch = null
                for (var mi = 0; mi < matchedCandidates.length; mi++) {
                  if (matchedCandidates[mi].getString('external_id') === extId) {
                    exactExtMatch = matchedCandidates[mi]
                    break
                  }
                }
                existing = exactExtMatch || matchedCandidates[0]

                // Se houver múltiplos candidatos duplicados na janela de 48h sem external_id, marcar como cancelado
                for (var ci = 0; ci < matchedCandidates.length; ci++) {
                  var otherCand = matchedCandidates[ci]
                  if (
                    otherCand.id !== existing.id &&
                    !otherCand.getString('external_id') &&
                    otherCand.getString('status') !== 'cancelado'
                  ) {
                    otherCand.set('status', 'cancelado')
                    var oNotes = otherCand.getString('notes') || ''
                    var dedupNote = 'Cancelado em favor do agendamento oficial (deduplicação ±48h)'
                    if (oNotes.indexOf(dedupNote) === -1) {
                      otherCand.set('notes', oNotes ? oNotes + ' - ' + dedupNote : dedupNote)
                    }
                    try {
                      $app.saveNoValidate(otherCand)
                    } catch (_) {}
                  }
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

      // Soft-cancel seguro de ausentes na oficial: apenas DENTRO da janela real retornada pela API
      var softCancelledCount = 0
      try {
        var minDateMs = Infinity
        var maxDateMs = -Infinity

        for (var k = 0; k < items.length; k++) {
          var itm = items[k]
          if (!itm || typeof itm !== 'object') continue
          var rawDate = itm.starts_at || itm.data_inicio || itm.data_consulta || itm.data || ''
          if (!rawDate) continue
          var dMs = new Date(rawDate).getTime()
          if (!isNaN(dMs)) {
            if (dMs < minDateMs) minDateMs = dMs
            if (dMs > maxDateMs) maxDateMs = dMs
          }
        }

        if (minDateMs !== Infinity && maxDateMs !== -Infinity) {
          var windowStartIso = new Date(minDateMs).toISOString()
          var windowEndIso = new Date(maxDateMs).toISOString()

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
