/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIA BIDIRECIONAL DE AGENDA
 *
 * Integra a agenda deste CRM com a agenda do outro projeto PocketBase Skip do Dr. Caio.
 * Credenciais necessárias (configuráveis via variáveis de ambiente/secrets):
 * - AGENDA_SYNC_URL: ex: "https://agenda-externa.internal.goskip.dev"
 * - AGENDA_SYNC_EMAIL: email de autenticação no PocketBase externo
 * - AGENDA_SYNC_PASSWORD: senha de autenticação no PocketBase externo
 */

// CRON DE SINCRONIZAÇÃO A CADA 5 MINUTOS NO MINUTO 2 (2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57)
// Escalonado: não colide com crons de minuto 0 (horários cheios), nem com outros intervalos concorrentes.
cronAdd('agenda_external_sync', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *', () => {
  $app.logger().info('agenda_external_sync cron started')

  function sanitizeUrl(raw) {
    if (!raw) return ''
    var trimmed = String(raw).trim()
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  }

  function cleanDigits(val) {
    if (!val) return ''
    return String(val).replace(/\D/g, '')
  }

  function normalizeCity(raw) {
    if (!raw) return 'Carmo do Rio Claro'
    var s = String(raw).toLowerCase()
    if (s.indexOf('alfenas') !== -1 || s.indexOf('harmoniza') !== -1) return 'Alfenas'
    if (s.indexOf('monte belo') !== -1) return 'Monte Belo'
    if (s.indexOf('online') !== -1 || s.indexOf('remoto') !== -1 || s.indexOf('distancia') !== -1)
      return 'Online'
    if (s.indexOf('carmo') !== -1 || s.indexOf('climed') !== -1) return 'Carmo do Rio Claro'
    return 'Carmo do Rio Claro'
  }

  function normalizeStatus(raw) {
    if (!raw) return 'agendado'
    var s = String(raw).toLowerCase()
    if (s.indexOf('confirm') !== -1) return 'confirmado'
    if (s.indexOf('realiz') !== -1 || s.indexOf('conclu') !== -1 || s.indexOf('atendido') !== -1)
      return 'realizado'
    if (s.indexOf('falt') !== -1 || s.indexOf('ausen') !== -1) return 'faltou'
    if (s.indexOf('remarc') !== -1) return 'remarcado'
    if (s.indexOf('cancel') !== -1 || s.indexOf('desmarc') !== -1) return 'cancelado'
    return 'agendado'
  }

  function linkPatientAndConversation(record) {
    var phone = record.getString('patient_phone')
    if (!phone) return

    var digits = cleanDigits(phone)
    if (!digits || digits.length < 8) return

    var phoneSuffix = digits.slice(-8)

    if (!record.getString('patient_id')) {
      try {
        var contact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'phone ~ {:suf} || jid ~ {:suf}',
          { suf: phoneSuffix },
        )
        if (contact) {
          record.set('patient_id', contact.id)
          if (!record.getString('account_id') && contact.getString('account_id')) {
            record.set('account_id', contact.getString('account_id'))
          }
        }
      } catch (_) {}
    }

    if (!record.getString('conversation_id')) {
      try {
        var conv = $app.findFirstRecordByFilter(
          'conversations',
          'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
          { suf: phoneSuffix },
        )
        if (conv) {
          record.set('conversation_id', conv.id)
          if (!record.getString('account_id') && conv.getString('account_id')) {
            record.set('account_id', conv.getString('account_id'))
          }
        }
      } catch (_) {}
    }
  }

  var syncKey = 'agenda_externa_dr_caio'
  var extUrl = sanitizeUrl($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '')
  var extEmail = ($secrets.get('AGENDA_SYNC_EMAIL') || $os.getenv('AGENDA_SYNC_EMAIL') || '').trim()
  var extPass = (
    $secrets.get('AGENDA_SYNC_PASSWORD') ||
    $os.getenv('AGENDA_SYNC_PASSWORD') ||
    ''
  ).trim()

  var syncStateRec = null
  try {
    syncStateRec = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', { k: syncKey })
  } catch (_) {
    try {
      var col = $app.findCollectionByNameOrId('sync_state')
      syncStateRec = new Record(col)
      syncStateRec.set('key', syncKey)
      syncStateRec.set('last_status', 'pending_credentials')
      syncStateRec.set(
        'details',
        JSON.stringify({ message: 'Aguardando credenciais AGENDA_SYNC_*' }),
      )
      $app.save(syncStateRec)
    } catch (createErr) {
      $app
        .logger()
        .warn('agenda_sync: failed to init sync_state record', 'error', String(createErr))
    }
  }

  if (!extUrl || !extEmail || !extPass) {
    var missing = []
    if (!extUrl) missing.push('AGENDA_SYNC_URL')
    if (!extEmail) missing.push('AGENDA_SYNC_EMAIL')
    if (!extPass) missing.push('AGENDA_SYNC_PASSWORD')
    var missingMsg = 'Sincronia não configurada: faltam credenciais (' + missing.join(', ') + ')'

    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'missing_credentials')
        syncStateRec.set('last_error', missingMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({ missing_envs: missing, checked_at: new Date().toISOString() }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  // 1. Autenticar no PocketBase externo via auth-with-password
  var extToken = ''
  try {
    var authRes = $http.send({
      url: extUrl + '/api/collections/users/auth-with-password',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: extEmail, password: extPass }),
      timeout: 15,
    })

    if (authRes.statusCode !== 200 || !authRes.json || !authRes.json.token) {
      var errMsg =
        'Falha de autenticação no PB externo: HTTP ' +
        authRes.statusCode +
        ' ' +
        (authRes.raw || '')
      if (syncStateRec) {
        syncStateRec.set('last_status', 'auth_failed')
        syncStateRec.set('last_error', errMsg)
        $app.save(syncStateRec)
      }
      return
    }

    extToken = authRes.json.token
  } catch (authErr) {
    var exMsg = 'Erro de conexão com o PB externo: ' + String(authErr)
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'connection_error')
        syncStateRec.set('last_error', exMsg)
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  var authHeaders = {
    'Content-Type': 'application/json',
    Authorization: extToken,
  }

  var pulledCount = 0
  var pushedCount = 0
  var syncErrors = []

  // 2. PULL: buscar registros do PB externo alterados desde last_sync
  var lastSyncDate = syncStateRec ? syncStateRec.getString('last_sync') : ''
  var targetExtCollection = 'appointments'
  try {
    var testReq = $http.send({
      url: extUrl + '/api/collections/appointments/records?perPage=1',
      method: 'GET',
      headers: authHeaders,
      timeout: 10,
    })
    if (testReq.statusCode === 404) {
      targetExtCollection = 'agendamentos'
    }
  } catch (_) {
    targetExtCollection = 'appointments'
  }

  var pullFilter = ''
  if (lastSyncDate) {
    pullFilter = 'updated >= "' + lastSyncDate + '"'
  }

  var pullUrl =
    extUrl + '/api/collections/' + targetExtCollection + '/records?perPage=25&sort=updated'
  if (pullFilter) {
    pullUrl += '&filter=' + encodeURIComponent(pullFilter)
  }

  try {
    var pullRes = $http.send({
      url: pullUrl,
      method: 'GET',
      headers: authHeaders,
      timeout: 15,
    })

    if (pullRes.statusCode === 200 && pullRes.json && Array.isArray(pullRes.json.items)) {
      var extItems = pullRes.json.items
      var appointmentsCol = $app.findCollectionByNameOrId('appointments')

      for (var i = 0; i < extItems.length; i++) {
        var item = extItems[i]
        var extId = item.id || ''
        if (!extId) continue

        var existing = null
        try {
          existing = $app.findFirstRecordByFilter(
            'appointments',
            'external_id = {:eid} && source = "agenda_externa"',
            { eid: extId },
          )
        } catch (_) {}

        if (existing) {
          var localUpdated = existing.getString('updated')
          var remoteUpdated = item.updated || ''
          if (localUpdated && remoteUpdated && localUpdated > remoteUpdated) {
            continue
          }
        }

        var rec = existing || new Record(appointmentsCol)
        rec.set('source', 'agenda_externa')
        rec.set('external_id', extId)
        rec.set(
          'patient_name',
          item.patient_name || item.paciente_nome || item.name || item.nome || 'Paciente sem nome',
        )
        rec.set(
          'patient_phone',
          item.patient_phone || item.paciente_telefone || item.phone || item.telefone || '',
        )
        rec.set('doctor', item.doctor || item.medico || item.nutricionista || 'Dr. Caio')
        rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
        rec.set('location', item.location || item.local || item.clinica || 'Climed')
        rec.set(
          'starts_at',
          item.starts_at ||
            item.data_inicio ||
            item.data_hora ||
            item.data ||
            new Date().toISOString(),
        )
        rec.set(
          'ends_at',
          item.ends_at || item.data_fim || item.starts_at || new Date().toISOString(),
        )
        rec.set('status', normalizeStatus(item.status || item.situacao || 'agendado'))
        rec.set(
          'appointment_type',
          item.appointment_type || item.tipo_consulta || item.tipo || 'Primeira consulta',
        )
        rec.set('notes', item.notes || item.observacoes || item.descricao || '')
        rec.set('sync_hash', item.updated || item.id)
        rec.set('last_synced_at', new Date().toISOString())
        rec.set('sync_error', '')

        linkPatientAndConversation(rec)

        try {
          $app.save(rec)
          pulledCount++
        } catch (saveErr) {
          syncErrors.push('Erro ao salvar registro externo ' + extId + ': ' + String(saveErr))
        }
      }
    }
  } catch (pullErr) {
    syncErrors.push('Falha no pull da agenda externa: ' + String(pullErr))
  }

  // 3. PUSH: registros criados ou alterados AQUI com source="crm"
  try {
    var pendingPush = $app.findRecordsByFilter(
      'appointments',
      'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
      '+updated',
      25,
      0,
    )

    for (var p = 0; p < pendingPush.length; p++) {
      var localItem = pendingPush[p]
      var extIdForPush = localItem.getString('external_id')
      var payload = {
        patient_name: localItem.getString('patient_name'),
        patient_phone: localItem.getString('patient_phone'),
        doctor: localItem.getString('doctor') || 'Dr. Caio',
        city: localItem.getString('city'),
        location: localItem.getString('location'),
        starts_at: localItem.getString('starts_at'),
        ends_at: localItem.getString('ends_at'),
        status: localItem.getString('status'),
        appointment_type: localItem.getString('appointment_type'),
        notes: localItem.getString('notes'),
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
          timeout: 15,
        })

        if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
          if (pushRes.json && pushRes.json.id) {
            localItem.set('external_id', pushRes.json.id)
          }
          localItem.set('last_synced_at', new Date().toISOString())
          localItem.set('sync_error', '')
          $app.save(localItem)
          pushedCount++
        } else {
          var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '')
          localItem.set('sync_error', pushErr.slice(0, 300))
          $app.save(localItem)
          syncErrors.push(pushErr)
        }
      } catch (pushErrEx) {
        var exString = 'Push falhou: ' + String(pushErrEx)
        localItem.set('sync_error', exString.slice(0, 300))
        try {
          $app.save(localItem)
        } catch (_) {}
        syncErrors.push(exString)
      }
    }
  } catch (findPushErr) {
    syncErrors.push('Erro ao selecionar registros para push: ' + String(findPushErr))
  }

  // 4. Atualizar sync_state com o resultado deste ciclo
  var finalStatus =
    syncErrors.length === 0 ? 'success' : pulledCount > 0 || pushedCount > 0 ? 'partial' : 'error'
  if (syncStateRec) {
    try {
      syncStateRec.set('last_sync', new Date().toISOString())
      syncStateRec.set('last_status', finalStatus)
      syncStateRec.set(
        'last_error',
        syncErrors.length > 0 ? syncErrors.slice(0, 3).join(' | ') : '',
      )
      syncStateRec.set(
        'details',
        JSON.stringify({
          pulled: pulledCount,
          pushed: pushedCount,
          errors: syncErrors.slice(0, 5),
          synced_at: new Date().toISOString(),
        }),
      )
      $app.save(syncStateRec)
    } catch (_) {}
  }

  $app
    .logger()
    .info(
      'agenda_external_sync cron finished',
      'status',
      finalStatus,
      'pulled',
      pulledCount,
      'pushed',
      pushedCount,
    )
})

// ENDPOINT MANUAL PARA FORÇAR SYNC (chamado pelo botão de sincronizar na UI)
routerAdd(
  'POST',
  '/backend/v1/agenda/sync',
  (e) => {
    try {
      function sanitizeUrl(raw) {
        if (!raw) return ''
        var trimmed = String(raw).trim()
        return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
      }

      function cleanDigits(val) {
        if (!val) return ''
        return String(val).replace(/\D/g, '')
      }

      function normalizeCity(raw) {
        if (!raw) return 'Carmo do Rio Claro'
        var s = String(raw).toLowerCase()
        if (s.indexOf('alfenas') !== -1 || s.indexOf('harmoniza') !== -1) return 'Alfenas'
        if (s.indexOf('monte belo') !== -1) return 'Monte Belo'
        if (
          s.indexOf('online') !== -1 ||
          s.indexOf('remoto') !== -1 ||
          s.indexOf('distancia') !== -1
        )
          return 'Online'
        if (s.indexOf('carmo') !== -1 || s.indexOf('climed') !== -1) return 'Carmo do Rio Claro'
        return 'Carmo do Rio Claro'
      }

      function normalizeStatus(raw) {
        if (!raw) return 'agendado'
        var s = String(raw).toLowerCase()
        if (s.indexOf('confirm') !== -1) return 'confirmado'
        if (
          s.indexOf('realiz') !== -1 ||
          s.indexOf('conclu') !== -1 ||
          s.indexOf('atendido') !== -1
        )
          return 'realizado'
        if (s.indexOf('falt') !== -1 || s.indexOf('ausen') !== -1) return 'faltou'
        if (s.indexOf('remarc') !== -1) return 'remarcado'
        if (s.indexOf('cancel') !== -1 || s.indexOf('desmarc') !== -1) return 'cancelado'
        return 'agendado'
      }

      function linkPatientAndConversation(record) {
        var phone = record.getString('patient_phone')
        if (!phone) return

        var digits = cleanDigits(phone)
        if (!digits || digits.length < 8) return

        var phoneSuffix = digits.slice(-8)

        if (!record.getString('patient_id')) {
          try {
            var contact = $app.findFirstRecordByFilter(
              'crm_contacts',
              'phone ~ {:suf} || jid ~ {:suf}',
              { suf: phoneSuffix },
            )
            if (contact) {
              record.set('patient_id', contact.id)
              if (!record.getString('account_id') && contact.getString('account_id')) {
                record.set('account_id', contact.getString('account_id'))
              }
            }
          } catch (_) {}
        }

        if (!record.getString('conversation_id')) {
          try {
            var conv = $app.findFirstRecordByFilter(
              'conversations',
              'remote_jid ~ {:suf} || contact_phone ~ {:suf}',
              { suf: phoneSuffix },
            )
            if (conv) {
              record.set('conversation_id', conv.id)
              if (!record.getString('account_id') && conv.getString('account_id')) {
                record.set('account_id', conv.getString('account_id'))
              }
            }
          } catch (_) {}
        }
      }

      var syncKey = 'agenda_externa_dr_caio'
      var extUrl = sanitizeUrl(
        $secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '',
      )
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

      var syncStateRec = null
      try {
        syncStateRec = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', { k: syncKey })
      } catch (_) {
        try {
          var col = $app.findCollectionByNameOrId('sync_state')
          syncStateRec = new Record(col)
          syncStateRec.set('key', syncKey)
          syncStateRec.set('last_status', 'pending_credentials')
          syncStateRec.set(
            'details',
            JSON.stringify({ message: 'Aguardando credenciais AGENDA_SYNC_*' }),
          )
          $app.save(syncStateRec)
        } catch (createErr) {
          $app
            .logger()
            .warn('agenda_sync: failed to init sync_state record', 'error', String(createErr))
        }
      }

      if (!extUrl || !extEmail || !extPass) {
        var missing = []
        if (!extUrl) missing.push('AGENDA_SYNC_URL')
        if (!extEmail) missing.push('AGENDA_SYNC_EMAIL')
        if (!extPass) missing.push('AGENDA_SYNC_PASSWORD')
        var missingMsg =
          'Sincronia não configurada: faltam credenciais (' + missing.join(', ') + ')'

        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'missing_credentials')
            syncStateRec.set('last_error', missingMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({ missing_envs: missing, checked_at: new Date().toISOString() }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }

        return e.json(200, {
          success: false,
          status: 'missing_credentials',
          message: missingMsg,
          missing_credentials: missing,
          pulled: 0,
          pushed: 0,
        })
      }

      var extToken = ''
      try {
        var authRes = $http.send({
          url: extUrl + '/api/collections/users/auth-with-password',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: extEmail, password: extPass }),
          timeout: 15,
        })

        if (authRes.statusCode !== 200 || !authRes.json || !authRes.json.token) {
          var errMsg =
            'Falha de autenticação no PB externo: HTTP ' +
            authRes.statusCode +
            ' ' +
            (authRes.raw || '')
          if (syncStateRec) {
            syncStateRec.set('last_status', 'auth_failed')
            syncStateRec.set('last_error', errMsg)
            $app.save(syncStateRec)
          }
          return e.json(200, {
            success: false,
            status: 'auth_failed',
            message: errMsg,
            pulled: 0,
            pushed: 0,
          })
        }

        extToken = authRes.json.token
      } catch (authErr) {
        var exMsg = 'Erro de conexão com o PB externo: ' + String(authErr)
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'connection_error')
            syncStateRec.set('last_error', exMsg)
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(200, {
          success: false,
          status: 'connection_error',
          message: exMsg,
          pulled: 0,
          pushed: 0,
        })
      }

      var authHeaders = {
        'Content-Type': 'application/json',
        Authorization: extToken,
      }

      var pulledCount = 0
      var pushedCount = 0
      var syncErrors = []

      var lastSyncDate = syncStateRec ? syncStateRec.getString('last_sync') : ''
      var targetExtCollection = 'appointments'
      try {
        var testReq = $http.send({
          url: extUrl + '/api/collections/appointments/records?perPage=1',
          method: 'GET',
          headers: authHeaders,
          timeout: 10,
        })
        if (testReq.statusCode === 404) {
          targetExtCollection = 'agendamentos'
        }
      } catch (_) {
        targetExtCollection = 'appointments'
      }

      var pullFilter = ''
      if (lastSyncDate) {
        pullFilter = 'updated >= "' + lastSyncDate + '"'
      }

      var pullUrl =
        extUrl + '/api/collections/' + targetExtCollection + '/records?perPage=25&sort=updated'
      if (pullFilter) {
        pullUrl += '&filter=' + encodeURIComponent(pullFilter)
      }

      try {
        var pullRes = $http.send({
          url: pullUrl,
          method: 'GET',
          headers: authHeaders,
          timeout: 15,
        })

        if (pullRes.statusCode === 200 && pullRes.json && Array.isArray(pullRes.json.items)) {
          var extItems = pullRes.json.items
          var appointmentsCol = $app.findCollectionByNameOrId('appointments')

          for (var i = 0; i < extItems.length; i++) {
            var item = extItems[i]
            var extId = item.id || ''
            if (!extId) continue

            var existing = null
            try {
              existing = $app.findFirstRecordByFilter(
                'appointments',
                'external_id = {:eid} && source = "agenda_externa"',
                { eid: extId },
              )
            } catch (_) {}

            if (existing) {
              var localUpdated = existing.getString('updated')
              var remoteUpdated = item.updated || ''
              if (localUpdated && remoteUpdated && localUpdated > remoteUpdated) {
                continue
              }
            }

            var rec = existing || new Record(appointmentsCol)
            rec.set('source', 'agenda_externa')
            rec.set('external_id', extId)
            rec.set(
              'patient_name',
              item.patient_name ||
                item.paciente_nome ||
                item.name ||
                item.nome ||
                'Paciente sem nome',
            )
            rec.set(
              'patient_phone',
              item.patient_phone || item.paciente_telefone || item.phone || item.telefone || '',
            )
            rec.set('doctor', item.doctor || item.medico || item.nutricionista || 'Dr. Caio')
            rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
            rec.set('location', item.location || item.local || item.clinica || 'Climed')
            rec.set(
              'starts_at',
              item.starts_at ||
                item.data_inicio ||
                item.data_hora ||
                item.data ||
                new Date().toISOString(),
            )
            rec.set(
              'ends_at',
              item.ends_at || item.data_fim || item.starts_at || new Date().toISOString(),
            )
            rec.set('status', normalizeStatus(item.status || item.situacao || 'agendado'))
            rec.set(
              'appointment_type',
              item.appointment_type || item.tipo_consulta || item.tipo || 'Primeira consulta',
            )
            rec.set('notes', item.notes || item.observacoes || item.descricao || '')
            rec.set('sync_hash', item.updated || item.id)
            rec.set('last_synced_at', new Date().toISOString())
            rec.set('sync_error', '')

            linkPatientAndConversation(rec)

            try {
              $app.save(rec)
              pulledCount++
            } catch (saveErr) {
              syncErrors.push('Erro ao salvar registro externo ' + extId + ': ' + String(saveErr))
            }
          }
        }
      } catch (pullErr) {
        syncErrors.push('Falha no pull da agenda externa: ' + String(pullErr))
      }

      try {
        var pendingPush = $app.findRecordsByFilter(
          'appointments',
          'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
          '+updated',
          25,
          0,
        )

        for (var p = 0; p < pendingPush.length; p++) {
          var localItem = pendingPush[p]
          var extIdForPush = localItem.getString('external_id')
          var payload = {
            patient_name: localItem.getString('patient_name'),
            patient_phone: localItem.getString('patient_phone'),
            doctor: localItem.getString('doctor') || 'Dr. Caio',
            city: localItem.getString('city'),
            location: localItem.getString('location'),
            starts_at: localItem.getString('starts_at'),
            ends_at: localItem.getString('ends_at'),
            status: localItem.getString('status'),
            appointment_type: localItem.getString('appointment_type'),
            notes: localItem.getString('notes'),
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
              timeout: 15,
            })

            if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
              if (pushRes.json && pushRes.json.id) {
                localItem.set('external_id', pushRes.json.id)
              }
              localItem.set('last_synced_at', new Date().toISOString())
              localItem.set('sync_error', '')
              $app.save(localItem)
              pushedCount++
            } else {
              var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '')
              localItem.set('sync_error', pushErr.slice(0, 300))
              $app.save(localItem)
              syncErrors.push(pushErr)
            }
          } catch (pushErrEx) {
            var exString = 'Push falhou: ' + String(pushErrEx)
            localItem.set('sync_error', exString.slice(0, 300))
            try {
              $app.save(localItem)
            } catch (_) {}
            syncErrors.push(exString)
          }
        }
      } catch (findPushErr) {
        syncErrors.push('Erro ao selecionar registros para push: ' + String(findPushErr))
      }

      var finalStatus =
        syncErrors.length === 0
          ? 'success'
          : pulledCount > 0 || pushedCount > 0
            ? 'partial'
            : 'error'
      if (syncStateRec) {
        try {
          syncStateRec.set('last_sync', new Date().toISOString())
          syncStateRec.set('last_status', finalStatus)
          syncStateRec.set(
            'last_error',
            syncErrors.length > 0 ? syncErrors.slice(0, 3).join(' | ') : '',
          )
          syncStateRec.set(
            'details',
            JSON.stringify({
              pulled: pulledCount,
              pushed: pushedCount,
              errors: syncErrors.slice(0, 5),
              synced_at: new Date().toISOString(),
            }),
          )
          $app.save(syncStateRec)
        } catch (_) {}
      }

      return e.json(200, {
        success: finalStatus === 'success' || finalStatus === 'partial',
        status: finalStatus,
        pulled: pulledCount,
        pushed: pushedCount,
        errors: syncErrors,
        last_sync: new Date().toISOString(),
      })
    } catch (err) {
      $app.logger().error('agenda_sync endpoint error', 'error', String(err))
      return e.json(500, { error: 'Falha ao sincronizar agenda: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)

// ENDPOINT DE STATUS DA SINCRONIA
routerAdd(
  'GET',
  '/backend/v1/agenda/sync-status',
  (e) => {
    try {
      function sanitizeUrl(raw) {
        if (!raw) return ''
        var trimmed = String(raw).trim()
        return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
      }

      var syncState = null
      try {
        syncState = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', {
          k: 'agenda_externa_dr_caio',
        })
      } catch (_) {}

      var extUrl = sanitizeUrl(
        $secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '',
      )
      var extEmail = (
        $secrets.get('AGENDA_SYNC_EMAIL') ||
        $os.getenv('AGENDA_SYNC_EMAIL') ||
        ''
      ).trim()
      var isConfigured = Boolean(extUrl && extEmail)

      var details = null
      if (syncState && syncState.getString('details')) {
        try {
          details = JSON.parse(syncState.getString('details'))
        } catch (_) {}
      }

      var totalLocal = $app.countRecords('appointments')
      var pendingPushCount = 0
      try {
        pendingPushCount = $app.countRecords(
          'appointments',
          'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
        )
      } catch (_) {}

      return e.json(200, {
        configured: isConfigured,
        external_url: extUrl || null,
        last_sync: syncState ? syncState.getString('last_sync') : null,
        last_status: syncState
          ? syncState.getString('last_status')
          : isConfigured
            ? 'pending'
            : 'missing_credentials',
        last_error: syncState ? syncState.getString('last_error') : null,
        details: details,
        total_appointments: totalLocal,
        pending_push: pendingPushCount,
      })
    } catch (err) {
      return e.json(500, { error: 'Erro ao consultar status da sincronia: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)
