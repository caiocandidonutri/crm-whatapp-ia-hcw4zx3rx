/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIA DE AGENDA & CRM COM CHAMADA DIRETA POR TOKEN ESTÁTICO
 *
 * Integra a agenda deste CRM com a agenda/gestão externa do Dr. Caio.
 * Endpoint externo oficial:
 * GET https://<sua-agenda>/backend/v1/crm-dados?tipo=tudo
 * Header: X-CRM-Token: crm_agenda_token_dr_caio_2026 (ou Authorization: Bearer ...)
 *
 * Configuração:
 * - AGENDA_SYNC_URL (ex: https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo)
 * - AGENDA_CRM_TOKEN (ex: crm_agenda_token_dr_caio_2026)
 *
 * NOTA: Cada callback do PocketBase roda em uma VM isolada.
 * Portanto, toda a lógica auxiliar é declarada DENTRO do respectivo callback.
 */

// CRON DE SINCRONIZAÇÃO A CADA 5 MINUTOS NO MINUTO 2 (2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57)
cronAdd('agenda_external_sync', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *', () => {
  $app.logger().info('agenda_external_sync cron started')

  function getAgendaConfig() {
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken = ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim()

    if (!rawToken) {
      rawToken = 'crm_agenda_token_dr_caio_2026'
    }

    if (!rawUrl) {
      return {
        configured: false,
        baseUrl: '',
        pullUrl: '',
        token: rawToken,
        missing: ['AGENDA_SYNC_URL'],
      }
    }

    var normalized = rawUrl
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized
    }

    var queryIndex = normalized.indexOf('?')
    var queryString = ''
    var pathAndOrigin = normalized

    if (queryIndex !== -1) {
      queryString = normalized.slice(queryIndex)
      pathAndOrigin = normalized.slice(0, queryIndex)
    }

    if (pathAndOrigin.endsWith('/')) {
      pathAndOrigin = pathAndOrigin.slice(0, -1)
    }

    var pullUrl = ''
    var baseUrl = ''

    if (pathAndOrigin.indexOf('/backend/v1/crm-dados') !== -1) {
      pullUrl = pathAndOrigin + (queryString || '?tipo=tudo')
      var baseIdx = pathAndOrigin.indexOf('/backend/v1/crm-dados')
      baseUrl = pathAndOrigin.slice(0, baseIdx)
    } else {
      baseUrl = pathAndOrigin
      pullUrl = pathAndOrigin + '/backend/v1/crm-dados' + (queryString || '?tipo=tudo')
    }

    if (pullUrl.indexOf('tipo=') === -1) {
      pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + 'tipo=tudo'
    }

    return {
      configured: Boolean(pullUrl && rawToken),
      baseUrl: baseUrl,
      pullUrl: pullUrl,
      token: rawToken,
      missing: [],
    }
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

  var cfg = getAgendaConfig()
  var syncKey = 'agenda_externa_dr_caio'

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
        JSON.stringify({ message: 'Aguardando credenciais AGENDA_SYNC_URL / AGENDA_CRM_TOKEN' }),
      )
      $app.save(syncStateRec)
    } catch (createErr) {
      $app
        .logger()
        .warn('agenda_sync: failed to init sync_state record', 'error', String(createErr))
    }
  }

  if (!cfg.configured) {
    var missingMsg =
      'Sincronia não configurada: faltam credenciais (' + cfg.missing.join(', ') + ')'
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'missing_credentials')
        syncStateRec.set('last_error', missingMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({ missing_envs: cfg.missing, checked_at: new Date().toISOString() }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  var headers = {
    Accept: 'application/json',
    'X-CRM-Token': cfg.token,
    Authorization: 'Bearer ' + cfg.token,
  }

  var pulledCount = 0
  var pushedCount = 0
  var syncErrors = []
  var pulledContactsCount = 0

  var pullRes = null
  try {
    pullRes = $http.send({
      url: cfg.pullUrl,
      method: 'GET',
      headers: headers,
      timeout: 20,
    })
  } catch (netErr) {
    var conMsg = 'Erro de conexão ao chamar ' + cfg.pullUrl + ': ' + String(netErr)
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'connection_error')
        syncStateRec.set('last_error', conMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: cfg.pullUrl,
            error: String(netErr),
            checked_at: new Date().toISOString(),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  if (pullRes.statusCode === 401 || pullRes.statusCode === 403) {
    var authErrMsg =
      'Token de acesso rejeitado (HTTP ' + pullRes.statusCode + '). Verifique AGENDA_CRM_TOKEN.'
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'auth_failed')
        syncStateRec.set('last_error', authErrMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: cfg.pullUrl,
            status: pullRes.statusCode,
            raw: (pullRes.raw || '').slice(0, 500),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  if (pullRes.statusCode !== 200) {
    var httpErrMsg =
      'Resposta inesperada do endpoint crm-dados (HTTP ' +
      pullRes.statusCode +
      '): ' +
      (pullRes.raw || '').slice(0, 300)
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'error')
        syncStateRec.set('last_error', httpErrMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: cfg.pullUrl,
            status: pullRes.statusCode,
            raw: (pullRes.raw || '').slice(0, 500),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  var body = pullRes.json
  if (!body && pullRes.raw) {
    try {
      body = JSON.parse(pullRes.raw)
    } catch (parseErr) {
      syncErrors.push('Falha no parse do JSON da agenda externa: ' + String(parseErr))
    }
  }

  var extAppointments = []
  var extContacts = []

  if (body) {
    if (Array.isArray(body)) {
      extAppointments = body
    } else if (typeof body === 'object') {
      if (Array.isArray(body.appointments)) extAppointments = body.appointments
      else if (Array.isArray(body.agendamentos)) extAppointments = body.agendamentos
      else if (Array.isArray(body.items)) extAppointments = body.items
      else if (Array.isArray(body.consultas)) extAppointments = body.consultas
      else if (body.data && Array.isArray(body.data)) extAppointments = body.data
      else if (body.data && typeof body.data === 'object') {
        if (Array.isArray(body.data.appointments)) extAppointments = body.data.appointments
        if (Array.isArray(body.data.agendamentos)) extAppointments = body.data.agendamentos
        if (Array.isArray(body.data.contatos)) extContacts = body.data.contatos
        if (Array.isArray(body.data.contacts)) extContacts = body.data.contacts
      }

      if (Array.isArray(body.contatos)) extContacts = body.contatos
      else if (Array.isArray(body.contacts)) extContacts = body.contacts
      else if (Array.isArray(body.pacientes)) extContacts = body.pacientes
    }
  }

  var appointmentsCol = $app.findCollectionByNameOrId('appointments')

  for (var i = 0; i < extAppointments.length; i++) {
    var item = extAppointments[i]
    if (!item || typeof item !== 'object') continue

    var extId = String(item.id || item.external_id || item._id || item.codigo || '').trim()
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
      var remoteUpdated = item.updated || item.updated_at || item.data_modificacao || ''
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
        item.patient ||
        item.paciente ||
        item.name ||
        item.nome ||
        'Paciente sem nome',
    )
    rec.set(
      'patient_phone',
      item.patient_phone ||
        item.paciente_telefone ||
        item.phone ||
        item.telefone ||
        item.whatsapp ||
        '',
    )
    rec.set(
      'doctor',
      item.doctor || item.medico || item.nutricionista || item.profissional || 'Dr. Caio',
    )
    rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
    rec.set('location', item.location || item.local || item.clinica || 'Climed')

    var startsAt =
      item.starts_at ||
      item.start_time ||
      item.data_inicio ||
      item.data_hora ||
      item.data ||
      new Date().toISOString()
    var endsAt = item.ends_at || item.end_time || item.data_fim || item.starts_at || startsAt

    rec.set('starts_at', startsAt)
    rec.set('ends_at', endsAt)
    rec.set('status', normalizeStatus(item.status || item.situacao || item.estado || 'agendado'))
    rec.set(
      'appointment_type',
      item.appointment_type ||
        item.tipo_consulta ||
        item.tipo ||
        item.servico ||
        'Primeira consulta',
    )
    rec.set('notes', item.notes || item.observacoes || item.descricao || '')
    rec.set('sync_hash', item.updated || item.updated_at || item.id || extId)
    rec.set('last_synced_at', new Date().toISOString())
    rec.set('sync_error', '')

    linkPatientAndConversation(rec)

    try {
      $app.save(rec)
      pulledCount++
    } catch (saveErr) {
      syncErrors.push('Erro ao salvar agendamento externo ' + extId + ': ' + String(saveErr))
    }
  }

  if (extContacts && extContacts.length > 0) {
    try {
      var crmContactsCol = $app.findCollectionByNameOrId('crm_contacts')
      for (var c = 0; c < extContacts.length; c++) {
        var cItem = extContacts[c]
        if (!cItem || typeof cItem !== 'object') continue

        var phoneRaw = cItem.phone || cItem.telefone || cItem.whatsapp || cItem.celular || ''
        var digits = cleanDigits(phoneRaw)
        if (!digits || digits.length < 8) continue

        var suffix = digits.slice(-8)
        var contactRec = null
        try {
          contactRec = $app.findFirstRecordByFilter(
            'crm_contacts',
            'phone ~ {:suf} || jid ~ {:suf}',
            { suf: suffix },
          )
        } catch (_) {}

        if (!contactRec) {
          contactRec = new Record(crmContactsCol)
          contactRec.set('phone', phoneRaw)
          contactRec.set('is_patient', true)
        }

        var cName = cItem.name || cItem.nome || cItem.paciente_nome || cItem.contact_name
        if (
          cName &&
          (!contactRec.getString('contact_name') ||
            contactRec.getString('contact_name') === 'Novo Contato')
        ) {
          contactRec.set('contact_name', cName)
        }

        if (cItem.email && !contactRec.getString('email')) {
          contactRec.set('email', cItem.email)
        }

        contactRec.set('last_synced_at', new Date().toISOString())

        try {
          $app.save(contactRec)
          pulledContactsCount++
        } catch (_) {}
      }
    } catch (contColErr) {
      $app.logger().warn('agenda_sync: crm_contacts sync skipped', 'error', String(contColErr))
    }
  }

  try {
    var pendingPush = $app.findRecordsByFilter(
      'appointments',
      'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
      '+updated',
      25,
      0,
    )

    if (pendingPush.length > 0 && cfg.baseUrl) {
      for (var p = 0; p < pendingPush.length; p++) {
        var localItem = pendingPush[p]
        var extIdForPush = localItem.getString('external_id')
        var pushPayload = {
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

        var pushHeaders = {
          'Content-Type': 'application/json',
          'X-CRM-Token': cfg.token,
          Authorization: 'Bearer ' + cfg.token,
        }

        var pushUrl = cfg.baseUrl + '/backend/v1/agenda/agendamentos'
        var pushMethod = 'POST'
        if (extIdForPush) {
          pushUrl += '/' + extIdForPush
          pushMethod = 'PATCH'
        }

        try {
          var pushRes = $http.send({
            url: pushUrl,
            method: pushMethod,
            headers: pushHeaders,
            body: JSON.stringify(pushPayload),
            timeout: 10,
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
            var pushErr =
              'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 200)
            localItem.set('sync_error', pushErr)
            $app.save(localItem)
            syncErrors.push(pushErr)
          }
        } catch (pushEx) {
          var exStr = 'Push falhou: ' + String(pushEx).slice(0, 200)
          localItem.set('sync_error', exStr)
          try {
            $app.save(localItem)
          } catch (_) {}
          syncErrors.push(exStr)
        }
      }
    }
  } catch (findPushErr) {
    syncErrors.push('Erro ao selecionar agendamentos para push: ' + String(findPushErr))
  }

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
          pull_url: cfg.pullUrl,
          pulled: pulledCount,
          pulled_contacts: pulledContactsCount,
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

// ENDPOINT MANUAL PARA FORÇAR SYNC (chamado pelo botão na UI)
routerAdd(
  'POST',
  '/backend/v1/agenda/sync',
  (e) => {
    try {
      function getAgendaConfig() {
        var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
        var rawToken = (
          $secrets.get('AGENDA_CRM_TOKEN') ||
          $os.getenv('AGENDA_CRM_TOKEN') ||
          ''
        ).trim()

        if (!rawToken) {
          rawToken = 'crm_agenda_token_dr_caio_2026'
        }

        if (!rawUrl) {
          return {
            configured: false,
            baseUrl: '',
            pullUrl: '',
            token: rawToken,
            missing: ['AGENDA_SYNC_URL'],
          }
        }

        var normalized = rawUrl
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
          normalized = 'https://' + normalized
        }

        var queryIndex = normalized.indexOf('?')
        var queryString = ''
        var pathAndOrigin = normalized

        if (queryIndex !== -1) {
          queryString = normalized.slice(queryIndex)
          pathAndOrigin = normalized.slice(0, queryIndex)
        }

        if (pathAndOrigin.endsWith('/')) {
          pathAndOrigin = pathAndOrigin.slice(0, -1)
        }

        var pullUrl = ''
        var baseUrl = ''

        if (pathAndOrigin.indexOf('/backend/v1/crm-dados') !== -1) {
          pullUrl = pathAndOrigin + (queryString || '?tipo=tudo')
          var baseIdx = pathAndOrigin.indexOf('/backend/v1/crm-dados')
          baseUrl = pathAndOrigin.slice(0, baseIdx)
        } else {
          baseUrl = pathAndOrigin
          pullUrl = pathAndOrigin + '/backend/v1/crm-dados' + (queryString || '?tipo=tudo')
        }

        if (pullUrl.indexOf('tipo=') === -1) {
          pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + 'tipo=tudo'
        }

        return {
          configured: Boolean(pullUrl && rawToken),
          baseUrl: baseUrl,
          pullUrl: pullUrl,
          token: rawToken,
          missing: [],
        }
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

      var cfg = getAgendaConfig()
      var syncKey = 'agenda_externa_dr_caio'

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
            JSON.stringify({
              message: 'Aguardando credenciais AGENDA_SYNC_URL / AGENDA_CRM_TOKEN',
            }),
          )
          $app.save(syncStateRec)
        } catch (createErr) {
          $app
            .logger()
            .warn('agenda_sync: failed to init sync_state record', 'error', String(createErr))
        }
      }

      if (!cfg.configured) {
        var missingMsg =
          'Sincronia não configurada: faltam credenciais (' + cfg.missing.join(', ') + ')'
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'missing_credentials')
            syncStateRec.set('last_error', missingMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({ missing_envs: cfg.missing, checked_at: new Date().toISOString() }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(200, {
          success: false,
          status: 'missing_credentials',
          message: missingMsg,
          pulled: 0,
          pushed: 0,
          errors: [missingMsg],
        })
      }

      var headers = {
        Accept: 'application/json',
        'X-CRM-Token': cfg.token,
        Authorization: 'Bearer ' + cfg.token,
      }

      var pulledCount = 0
      var pushedCount = 0
      var syncErrors = []
      var pulledContactsCount = 0

      var pullRes = null
      try {
        pullRes = $http.send({
          url: cfg.pullUrl,
          method: 'GET',
          headers: headers,
          timeout: 20,
        })
      } catch (netErr) {
        var conMsg = 'Erro de conexão ao chamar ' + cfg.pullUrl + ': ' + String(netErr)
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'connection_error')
            syncStateRec.set('last_error', conMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: cfg.pullUrl,
                error: String(netErr),
                checked_at: new Date().toISOString(),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(200, {
          success: false,
          status: 'connection_error',
          message: conMsg,
          pulled: 0,
          pushed: 0,
          errors: [conMsg],
        })
      }

      if (pullRes.statusCode === 401 || pullRes.statusCode === 403) {
        var authErrMsg =
          'Token de acesso rejeitado (HTTP ' + pullRes.statusCode + '). Verifique AGENDA_CRM_TOKEN.'
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'auth_failed')
            syncStateRec.set('last_error', authErrMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: cfg.pullUrl,
                status: pullRes.statusCode,
                raw: (pullRes.raw || '').slice(0, 500),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(200, {
          success: false,
          status: 'auth_failed',
          message: authErrMsg,
          pulled: 0,
          pushed: 0,
          errors: [authErrMsg],
        })
      }

      if (pullRes.statusCode !== 200) {
        var httpErrMsg =
          'Resposta inesperada do endpoint crm-dados (HTTP ' +
          pullRes.statusCode +
          '): ' +
          (pullRes.raw || '').slice(0, 300)
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'error')
            syncStateRec.set('last_error', httpErrMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: cfg.pullUrl,
                status: pullRes.statusCode,
                raw: (pullRes.raw || '').slice(0, 500),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(200, {
          success: false,
          status: 'error',
          message: httpErrMsg,
          pulled: 0,
          pushed: 0,
          errors: [httpErrMsg],
        })
      }

      var body = pullRes.json
      if (!body && pullRes.raw) {
        try {
          body = JSON.parse(pullRes.raw)
        } catch (parseErr) {
          syncErrors.push('Falha no parse do JSON da agenda externa: ' + String(parseErr))
        }
      }

      var extAppointments = []
      var extContacts = []

      if (body) {
        if (Array.isArray(body)) {
          extAppointments = body
        } else if (typeof body === 'object') {
          if (Array.isArray(body.appointments)) extAppointments = body.appointments
          else if (Array.isArray(body.agendamentos)) extAppointments = body.agendamentos
          else if (Array.isArray(body.items)) extAppointments = body.items
          else if (Array.isArray(body.consultas)) extAppointments = body.consultas
          else if (body.data && Array.isArray(body.data)) extAppointments = body.data
          else if (body.data && typeof body.data === 'object') {
            if (Array.isArray(body.data.appointments)) extAppointments = body.data.appointments
            if (Array.isArray(body.data.agendamentos)) extAppointments = body.data.agendamentos
            if (Array.isArray(body.data.contatos)) extContacts = body.data.contatos
            if (Array.isArray(body.data.contacts)) extContacts = body.data.contacts
          }

          if (Array.isArray(body.contatos)) extContacts = body.contatos
          else if (Array.isArray(body.contacts)) extContacts = body.contacts
          else if (Array.isArray(body.pacientes)) extContacts = body.pacientes
        }
      }

      var appointmentsCol = $app.findCollectionByNameOrId('appointments')

      for (var i = 0; i < extAppointments.length; i++) {
        var item = extAppointments[i]
        if (!item || typeof item !== 'object') continue

        var extId = String(item.id || item.external_id || item._id || item.codigo || '').trim()
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
          var remoteUpdated = item.updated || item.updated_at || item.data_modificacao || ''
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
            item.patient ||
            item.paciente ||
            item.name ||
            item.nome ||
            'Paciente sem nome',
        )
        rec.set(
          'patient_phone',
          item.patient_phone ||
            item.paciente_telefone ||
            item.phone ||
            item.telefone ||
            item.whatsapp ||
            '',
        )
        rec.set(
          'doctor',
          item.doctor || item.medico || item.nutricionista || item.profissional || 'Dr. Caio',
        )
        rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
        rec.set('location', item.location || item.local || item.clinica || 'Climed')

        var startsAt =
          item.starts_at ||
          item.start_time ||
          item.data_inicio ||
          item.data_hora ||
          item.data ||
          new Date().toISOString()
        var endsAt = item.ends_at || item.end_time || item.data_fim || item.starts_at || startsAt

        rec.set('starts_at', startsAt)
        rec.set('ends_at', endsAt)
        rec.set(
          'status',
          normalizeStatus(item.status || item.situacao || item.estado || 'agendado'),
        )
        rec.set(
          'appointment_type',
          item.appointment_type ||
            item.tipo_consulta ||
            item.tipo ||
            item.servico ||
            'Primeira consulta',
        )
        rec.set('notes', item.notes || item.observacoes || item.descricao || '')
        rec.set('sync_hash', item.updated || item.updated_at || item.id || extId)
        rec.set('last_synced_at', new Date().toISOString())
        rec.set('sync_error', '')

        linkPatientAndConversation(rec)

        try {
          $app.save(rec)
          pulledCount++
        } catch (saveErr) {
          syncErrors.push('Erro ao salvar agendamento externo ' + extId + ': ' + String(saveErr))
        }
      }

      if (extContacts && extContacts.length > 0) {
        try {
          var crmContactsCol = $app.findCollectionByNameOrId('crm_contacts')
          for (var c = 0; c < extContacts.length; c++) {
            var cItem = extContacts[c]
            if (!cItem || typeof cItem !== 'object') continue

            var phoneRaw = cItem.phone || cItem.telefone || cItem.whatsapp || cItem.celular || ''
            var digits = cleanDigits(phoneRaw)
            if (!digits || digits.length < 8) continue

            var suffix = digits.slice(-8)
            var contactRec = null
            try {
              contactRec = $app.findFirstRecordByFilter(
                'crm_contacts',
                'phone ~ {:suf} || jid ~ {:suf}',
                { suf: suffix },
              )
            } catch (_) {}

            if (!contactRec) {
              contactRec = new Record(crmContactsCol)
              contactRec.set('phone', phoneRaw)
              contactRec.set('is_patient', true)
            }

            var cName = cItem.name || cItem.nome || cItem.paciente_nome || cItem.contact_name
            if (
              cName &&
              (!contactRec.getString('contact_name') ||
                contactRec.getString('contact_name') === 'Novo Contato')
            ) {
              contactRec.set('contact_name', cName)
            }

            if (cItem.email && !contactRec.getString('email')) {
              contactRec.set('email', cItem.email)
            }

            contactRec.set('last_synced_at', new Date().toISOString())

            try {
              $app.save(contactRec)
              pulledContactsCount++
            } catch (_) {}
          }
        } catch (contColErr) {
          $app.logger().warn('agenda_sync: crm_contacts sync skipped', 'error', String(contColErr))
        }
      }

      try {
        var pendingPush = $app.findRecordsByFilter(
          'appointments',
          'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
          '+updated',
          25,
          0,
        )

        if (pendingPush.length > 0 && cfg.baseUrl) {
          for (var p = 0; p < pendingPush.length; p++) {
            var localItem = pendingPush[p]
            var extIdForPush = localItem.getString('external_id')
            var pushPayload = {
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

            var pushHeaders = {
              'Content-Type': 'application/json',
              'X-CRM-Token': cfg.token,
              Authorization: 'Bearer ' + cfg.token,
            }

            var pushUrl = cfg.baseUrl + '/backend/v1/agenda/agendamentos'
            var pushMethod = 'POST'
            if (extIdForPush) {
              pushUrl += '/' + extIdForPush
              pushMethod = 'PATCH'
            }

            try {
              var pushRes = $http.send({
                url: pushUrl,
                method: pushMethod,
                headers: pushHeaders,
                body: JSON.stringify(pushPayload),
                timeout: 10,
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
                var pushErr =
                  'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 200)
                localItem.set('sync_error', pushErr)
                $app.save(localItem)
                syncErrors.push(pushErr)
              }
            } catch (pushEx) {
              var exStr = 'Push falhou: ' + String(pushEx).slice(0, 200)
              localItem.set('sync_error', exStr)
              try {
                $app.save(localItem)
              } catch (_) {}
              syncErrors.push(exStr)
            }
          }
        }
      } catch (findPushErr) {
        syncErrors.push('Erro ao selecionar agendamentos para push: ' + String(findPushErr))
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
              pull_url: cfg.pullUrl,
              pulled: pulledCount,
              pulled_contacts: pulledContactsCount,
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
        pulled_contacts: pulledContactsCount,
        pushed: pushedCount,
        errors: syncErrors,
        last_sync: new Date().toISOString(),
        message:
          finalStatus === 'success'
            ? 'Sincronização concluída com sucesso (' + pulledCount + ' agendamentos importados).'
            : 'Sincronização com avisos/pendências (' + syncErrors.length + ' erro(s)).',
      })
    } catch (err) {
      $app.logger().error('agenda_sync endpoint error', 'error', String(err))
      return e.json(500, {
        success: false,
        status: 'error',
        error: 'Falha ao sincronizar agenda: ' + String(err),
      })
    }
  },
  $apis.requireAuth(),
)

// ENDPOINT DE STATUS DA SINCRONIA & DIAGNÓSTICO
routerAdd(
  'GET',
  '/backend/v1/agenda/sync-status',
  (e) => {
    try {
      function getAgendaConfig() {
        var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
        var rawToken = (
          $secrets.get('AGENDA_CRM_TOKEN') ||
          $os.getenv('AGENDA_CRM_TOKEN') ||
          ''
        ).trim()

        if (!rawToken) {
          rawToken = 'crm_agenda_token_dr_caio_2026'
        }

        if (!rawUrl) {
          return {
            configured: false,
            baseUrl: '',
            pullUrl: '',
            token: rawToken,
            missing: ['AGENDA_SYNC_URL'],
          }
        }

        var normalized = rawUrl
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
          normalized = 'https://' + normalized
        }

        var queryIndex = normalized.indexOf('?')
        var queryString = ''
        var pathAndOrigin = normalized

        if (queryIndex !== -1) {
          queryString = normalized.slice(queryIndex)
          pathAndOrigin = normalized.slice(0, queryIndex)
        }

        if (pathAndOrigin.endsWith('/')) {
          pathAndOrigin = pathAndOrigin.slice(0, -1)
        }

        var pullUrl = ''
        var baseUrl = ''

        if (pathAndOrigin.indexOf('/backend/v1/crm-dados') !== -1) {
          pullUrl = pathAndOrigin + (queryString || '?tipo=tudo')
          var baseIdx = pathAndOrigin.indexOf('/backend/v1/crm-dados')
          baseUrl = pathAndOrigin.slice(0, baseIdx)
        } else {
          baseUrl = pathAndOrigin
          pullUrl = pathAndOrigin + '/backend/v1/crm-dados' + (queryString || '?tipo=tudo')
        }

        if (pullUrl.indexOf('tipo=') === -1) {
          pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + 'tipo=tudo'
        }

        return {
          configured: Boolean(pullUrl && rawToken),
          baseUrl: baseUrl,
          pullUrl: pullUrl,
          token: rawToken,
          missing: [],
        }
      }

      var cfg = getAgendaConfig()
      var syncState = null
      try {
        syncState = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', {
          k: 'agenda_externa_dr_caio',
        })
      } catch (_) {}

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

      var confirmationSentCount = 0
      var reminderDaySentCount = 0
      var confirmedByPatientCount = 0
      try {
        confirmationSentCount = $app.countRecords('appointments', 'confirmation_sent_at != ""')
        reminderDaySentCount = $app.countRecords('appointments', 'reminder_day_sent_at != ""')
        confirmedByPatientCount = $app.countRecords(
          'appointments',
          'last_interaction_type = "confirmado_paciente"',
        )
      } catch (_) {}

      var liveTest = null
      if (cfg.configured) {
        try {
          var testRes = $http.send({
            url: cfg.pullUrl,
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-CRM-Token': cfg.token,
              Authorization: 'Bearer ' + cfg.token,
            },
            timeout: 8,
          })

          if (testRes.statusCode === 200) {
            liveTest = {
              status: 'ok',
              message: 'Conexão ok (HTTP 200). Endpoint acessível com token.',
              status_code: 200,
            }
          } else if (testRes.statusCode === 401 || testRes.statusCode === 403) {
            liveTest = {
              status: 'invalid_token',
              message: 'Token inválido ou não autorizado (HTTP ' + testRes.statusCode + ').',
              status_code: testRes.statusCode,
            }
          } else if (testRes.statusCode === 404 || testRes.statusCode === 405) {
            liveTest = {
              status: 'wrong_url',
              message:
                'URL incorreta ou rota inexistente na agenda externa (HTTP ' +
                testRes.statusCode +
                ').',
              status_code: testRes.statusCode,
            }
          } else {
            liveTest = {
              status: 'http_error',
              message: 'Endpoint externo retornou HTTP ' + testRes.statusCode,
              status_code: testRes.statusCode,
            }
          }
        } catch (tErr) {
          liveTest = {
            status: 'connection_error',
            message: 'Falha de conexão com a URL externa: ' + String(tErr).slice(0, 150),
          }
        }
      }

      var lastStatus = syncState
        ? syncState.getString('last_status')
        : cfg.configured
          ? 'pending'
          : 'missing_credentials'

      return e.json(200, {
        configured: cfg.configured,
        external_url: cfg.pullUrl || null,
        base_url: cfg.baseUrl || null,
        has_token: Boolean(cfg.token),
        token_preview: cfg.token ? cfg.token.slice(0, 4) + '...' + cfg.token.slice(-4) : null,
        last_sync: syncState ? syncState.getString('last_sync') : null,
        last_status: lastStatus,
        last_error: syncState ? syncState.getString('last_error') : null,
        details: details,
        diagnostic: liveTest,
        total_appointments: totalLocal,
        pending_push: pendingPushCount,
        reminders_stats: {
          confirmations_sent: confirmationSentCount,
          reminders_day_sent: reminderDaySentCount,
          confirmed_by_patient: confirmedByPatientCount,
        },
      })
    } catch (err) {
      return e.json(500, { error: 'Erro ao consultar status da sincronia: ' + String(err) })
    }
  },
  $apis.requireAuth(),
)
