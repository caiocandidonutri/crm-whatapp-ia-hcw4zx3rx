/// <reference path="../pb_data/types.d.ts" />

/**
 * MOTOR DE SINCRONIA DE AGENDA & CRM COM CHAMADA DIRETA POR TOKEN ESTÁTICO
 *
 * Integra a agenda deste CRM com a agenda/gestão externa do Dr. Caio.
 * Endpoint externo oficial:
 * GET https://<sua-agenda>/backend/v1/crm-dados?tipo=tudo&data_inicio=dd/MM/yyyy&data_fim=dd/MM/yyyy
 * Header: X-CRM-Token: crm_agenda_token_dr_caio_2026 (ou Authorization: Bearer ...)
 *
 * NOTA CRÍTICA DO POCKETBASE JSVM:
 * Cada callback (cronAdd / routerAdd) executa em uma VM isolada da pool.
 * Nenhuma função auxiliar ou variável de nível superior pode ser chamada de dentro do callback.
 * Toda a lógica, helpers e variáveis PRECISAM estar declarados DENTRO do respectivo callback.
 */

// 1. CRON DE SINCRONIZAÇÃO A CADA 2 MINUTOS
cronAdd('agenda_external_sync', '*/2 * * * *', () => {
  $app.logger().info('agenda_external_sync cron started')

  function formatBRDate(d) {
    var day = String(d.getDate())
    if (day.length < 2) day = '0' + day
    var month = String(d.getMonth() + 1)
    if (month.length < 2) month = '0' + month
    var year = d.getFullYear()
    return day + '/' + month + '/' + year
  }

  function getDefaultSyncDates() {
    var now = new Date()
    var past6m = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
    var future2m = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
    return {
      data_inicio: formatBRDate(past6m),
      data_fim: formatBRDate(future2m),
    }
  }

  function buildDateQuery(dates) {
    var d = dates || getDefaultSyncDates()
    return (
      'data_inicio=' +
      encodeURIComponent(d.data_inicio) +
      '&data_fim=' +
      encodeURIComponent(d.data_fim)
    )
  }

  var defaultDates = getDefaultSyncDates()
  var RECOMMENDED_URL =
    'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo&' +
    buildDateQuery(defaultDates)

  function isHtmlContent(raw) {
    if (!raw) return false
    var trimmed = String(raw).trim()
    if (trimmed.startsWith('<')) return true
    var lower = trimmed.toLowerCase()
    return lower.indexOf('<!doctype') !== -1 || lower.indexOf('<html') !== -1
  }

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
        isFallbackRecommended: false,
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

    if (pullUrl.indexOf('data_inicio=') === -1 || pullUrl.indexOf('data_fim=') === -1) {
      var dQuery = buildDateQuery(defaultDates)
      pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + dQuery
    }

    return {
      configured: Boolean(pullUrl && rawToken),
      baseUrl: baseUrl,
      pullUrl: pullUrl,
      token: rawToken,
      missing: [],
      rawConfiguredUrl: rawUrl,
      isFallbackRecommended: false,
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

  function pause(ms) {
    try {
      if (typeof sleep === 'function') {
        sleep(ms)
        return
      }
    } catch (_) {}
    var until = Date.now() + ms
    while (Date.now() < until) {}
  }

  function fetchWithRetry(url, reqHeaders, maxRetries) {
    var delays = [3000, 8000]
    var attempts = 0
    var lastError = null
    var res = null

    while (attempts <= maxRetries) {
      try {
        res = $http.send({
          url: url,
          method: 'GET',
          headers: reqHeaders,
          timeout: 20,
        })

        var code = res.statusCode
        var isTransient =
          code === 400 ||
          code === 429 ||
          code === 500 ||
          code === 502 ||
          code === 503 ||
          code === 504

        if (code === 200 || !isTransient || attempts === maxRetries) {
          return { res: res, error: null, attempts: attempts + 1 }
        }

        $app
          .logger()
          .warn(
            'agenda_sync cron: transient HTTP ' +
              code +
              ' on ' +
              url +
              '. Retrying in ' +
              delays[attempts] +
              'ms (attempt ' +
              (attempts + 1) +
              '/' +
              (maxRetries + 1) +
              ')',
          )
      } catch (err) {
        lastError = err
        if (attempts === maxRetries) {
          return { res: null, error: err, attempts: attempts + 1 }
        }
        $app
          .logger()
          .warn(
            'agenda_sync cron: network error on ' +
              url +
              ': ' +
              String(err) +
              '. Retrying in ' +
              delays[attempts] +
              'ms',
          )
      }

      pause(delays[attempts] || 3000)
      attempts++
    }

    return { res: res, error: lastError, attempts: attempts }
  }

  var cfg = getAgendaConfig()
  var syncKey = 'agenda_externa_dr_caio'

  var syncStateRec = null
  try {
    syncStateRec = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', { k: syncKey })
  } catch (_) {
    try {
      var syncStateCol = $app.findCollectionByNameOrId('sync_state')
      syncStateRec = new Record(syncStateCol)
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

  // Debug: gravar no details imediatamente antes do pull para termos visibilidade total
  if (syncStateRec) {
    try {
      syncStateRec.set(
        'details',
        JSON.stringify({
          pull_url: effectivePullUrl,
          configured_url: cfg.pullUrl,
          exec_time: new Date().toISOString(),
          note: 'iniciando pull',
        }),
      )
      $app.save(syncStateRec)
    } catch (_) {}
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

  var effectivePullUrl = cfg.pullUrl
  var effectiveBaseUrl = cfg.baseUrl
  var usedFallback = false

  var pullAttempt = fetchWithRetry(effectivePullUrl, headers, 2)
  var pullRes = pullAttempt.res

  if (!pullRes) {
    var conMsg =
      'Erro de conexão ao chamar ' +
      effectivePullUrl +
      ': ' +
      String(pullAttempt.error || 'sem resposta')
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'connection_error')
        syncStateRec.set('last_error', conMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: effectivePullUrl,
            error: String(pullAttempt.error),
            attempts: pullAttempt.attempts,
            checked_at: new Date().toISOString(),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  // Se retornou HTML ou 404/405, tentar fallback na URL recomendada
  var isHtml = isHtmlContent(pullRes.raw)
  if (isHtml || pullRes.statusCode === 404 || pullRes.statusCode === 405) {
    if (RECOMMENDED_URL && effectivePullUrl !== RECOMMENDED_URL) {
      $app
        .logger()
        .warn(
          'agenda_sync cron: configured URL returned HTML or 404 (' +
            pullRes.statusCode +
            '). Trying fallback to RECOMMENDED_URL.',
          'url',
          effectivePullUrl,
        )
      var fbAttempt = fetchWithRetry(RECOMMENDED_URL, headers, 1)
      if (fbAttempt.res && fbAttempt.res.statusCode === 200 && !isHtmlContent(fbAttempt.res.raw)) {
        pullRes = fbAttempt.res
        effectivePullUrl = RECOMMENDED_URL
        effectiveBaseUrl = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
        usedFallback = true
        isHtml = false
        $app
          .logger()
          .info(
            'agenda_sync cron: fallback to RECOMMENDED_URL succeeded! Continuing sync with recommended backend.',
          )
      }
    }
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
            url: effectivePullUrl,
            status: pullRes.statusCode,
            raw: (pullRes.raw || '').slice(0, 500),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  if (isHtml) {
    var wrongUrlMsg =
      'A URL configurada (' +
      (cfg.rawConfiguredUrl || cfg.pullUrl) +
      ') aponta para o SITE da agenda, não para o BACKEND dela. Troque o secret AGENDA_SYNC_URL para ' +
      RECOMMENDED_URL
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'wrong_url')
        syncStateRec.set('last_error', wrongUrlMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: cfg.pullUrl,
            recommended_url: RECOMMENDED_URL,
            status: pullRes.statusCode,
            content_type_hint: 'HTML_DETECTED',
            raw: (pullRes.raw || '').slice(0, 300),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  // HTTP 400 ou 5xx: erro interno do backend da agenda
  if (pullRes.statusCode === 400 || (pullRes.statusCode >= 500 && pullRes.statusCode <= 599)) {
    var extErrMsg =
      'O backend da agenda respondeu com erro interno (HTTP ' +
      pullRes.statusCode +
      '). O problema está no projeto da AGENDA (endpoint crm-dados), não no CRM. O /api/health dele está OK. Corrija o endpoint no projeto da agenda ou peça para o suporte da agenda verificar.'
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', 'external_error')
        syncStateRec.set('last_error', extErrMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: effectivePullUrl,
            status: pullRes.statusCode,
            classification: 'external_error',
            raw: (pullRes.raw || '').slice(0, 500),
            attempts: pullAttempt.attempts,
            checked_at: new Date().toISOString(),
          }),
        )
        $app.save(syncStateRec)
      } catch (_) {}
    }
    return
  }

  if (pullRes.statusCode !== 200) {
    var is404or405 = pullRes.statusCode === 404 || pullRes.statusCode === 405
    var httpErrMsg = is404or405
      ? 'URL incorreta ou rota inexistente na agenda externa (HTTP ' +
        pullRes.statusCode +
        '). Troque o secret AGENDA_SYNC_URL para ' +
        RECOMMENDED_URL
      : 'Resposta inesperada do endpoint crm-dados (HTTP ' +
        pullRes.statusCode +
        '): ' +
        (pullRes.raw || '').slice(0, 300)
    var st = is404or405 ? 'wrong_url' : 'error'
    if (syncStateRec) {
      try {
        syncStateRec.set('last_status', st)
        syncStateRec.set('last_error', httpErrMsg)
        syncStateRec.set(
          'details',
          JSON.stringify({
            url: effectivePullUrl,
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

  // Push CRM -> Agenda Externa
  try {
    var pendingPush = $app.findRecordsByFilter(
      'appointments',
      'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
      '+updated',
      25,
      0,
    )

    if (pendingPush.length > 0 && effectiveBaseUrl) {
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

        var pushUrl = effectiveBaseUrl + '/backend/v1/agenda/agendamentos'
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
          pull_url: effectivePullUrl,
          configured_url: cfg.pullUrl,
          used_fallback: usedFallback,
          pulled: pulledCount,
          pulled_contacts: pulledContactsCount,
          pushed: pushedCount,
          errors: syncErrors.slice(0, 5),
          synced_at: new Date().toISOString(),
          raw_snippet: pullRes ? String(pullRes.raw || '').slice(0, 500) : '',
          raw_status: pullRes ? pullRes.statusCode : 0,
          ext_appts_found: extAppointments ? extAppointments.length : 0,
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
      'extApptsLength',
      extAppointments ? extAppointments.length : 0,
      'statusCode',
      pullRes ? pullRes.statusCode : 0,
      'pushed',
      pushedCount,
      'rawSnippet',
      pullRes ? String(pullRes.raw || '').slice(0, 200) : '',
    )
})

// 2. ENDPOINT MANUAL DE PULL/PUSH
routerAdd(
  'POST',
  '/backend/v1/agenda/sync',
  (e) => {
    try {
      function formatBRDate(d) {
        var day = String(d.getDate())
        if (day.length < 2) day = '0' + day
        var month = String(d.getMonth() + 1)
        if (month.length < 2) month = '0' + month
        var year = d.getFullYear()
        return day + '/' + month + '/' + year
      }

      function getDefaultSyncDates() {
        var now = new Date()
        var past6m = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        var future2m = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
        return {
          data_inicio: formatBRDate(past6m),
          data_fim: formatBRDate(future2m),
        }
      }

      function buildDateQuery(dates) {
        var d = dates || getDefaultSyncDates()
        return (
          'data_inicio=' +
          encodeURIComponent(d.data_inicio) +
          '&data_fim=' +
          encodeURIComponent(d.data_fim)
        )
      }

      var defaultDates = getDefaultSyncDates()
      var RECOMMENDED_URL =
        'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo&' +
        buildDateQuery(defaultDates)

      function isHtmlContent(raw) {
        if (!raw) return false
        var trimmed = String(raw).trim()
        if (trimmed.startsWith('<')) return true
        var lower = trimmed.toLowerCase()
        return lower.indexOf('<!doctype') !== -1 || lower.indexOf('<html') !== -1
      }

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
            isFallbackRecommended: false,
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

        if (pullUrl.indexOf('data_inicio=') === -1 || pullUrl.indexOf('data_fim=') === -1) {
          var dQuery = buildDateQuery(defaultDates)
          pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + dQuery
        }

        return {
          configured: Boolean(pullUrl && rawToken),
          baseUrl: baseUrl,
          pullUrl: pullUrl,
          token: rawToken,
          missing: [],
          rawConfiguredUrl: rawUrl,
          isFallbackRecommended: false,
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

      function pause(ms) {
        try {
          if (typeof sleep === 'function') {
            sleep(ms)
            return
          }
        } catch (_) {}
        var until = Date.now() + ms
        while (Date.now() < until) {}
      }

      function fetchWithRetry(url, reqHeaders, maxRetries) {
        var delays = [3000, 8000]
        var attempts = 0
        var lastError = null
        var res = null

        while (attempts <= maxRetries) {
          try {
            res = $http.send({
              url: url,
              method: 'GET',
              headers: reqHeaders,
              timeout: 20,
            })

            var code = res.statusCode
            var isTransient =
              code === 400 ||
              code === 429 ||
              code === 500 ||
              code === 502 ||
              code === 503 ||
              code === 504

            if (code === 200 || !isTransient || attempts === maxRetries) {
              return { res: res, error: null, attempts: attempts + 1 }
            }

            $app
              .logger()
              .warn(
                'agenda_sync POST: transient HTTP ' +
                  code +
                  ' on ' +
                  url +
                  '. Retrying in ' +
                  delays[attempts] +
                  'ms (attempt ' +
                  (attempts + 1) +
                  '/' +
                  (maxRetries + 1) +
                  ')',
              )
          } catch (err) {
            lastError = err
            if (attempts === maxRetries) {
              return { res: null, error: err, attempts: attempts + 1 }
            }
            $app
              .logger()
              .warn(
                'agenda_sync POST: network error on ' +
                  url +
                  ': ' +
                  String(err) +
                  '. Retrying in ' +
                  delays[attempts] +
                  'ms',
              )
          }

          pause(delays[attempts] || 3000)
          attempts++
        }

        return { res: res, error: lastError, attempts: attempts }
      }

      var cfg = getAgendaConfig()
      var syncKey = 'agenda_externa_dr_caio'

      var syncStateRec = null
      try {
        syncStateRec = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', { k: syncKey })
      } catch (_) {
        try {
          var syncStateCol = $app.findCollectionByNameOrId('sync_state')
          syncStateRec = new Record(syncStateCol)
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
        return e.json(400, {
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

      var effectivePullUrl = cfg.pullUrl
      var effectiveBaseUrl = cfg.baseUrl
      var usedFallback = false

      var pullAttempt = fetchWithRetry(effectivePullUrl, headers, 2)
      var pullRes = pullAttempt.res

      if (!pullRes) {
        var conMsg =
          'Erro de conexão ao chamar ' +
          effectivePullUrl +
          ': ' +
          String(pullAttempt.error || 'sem resposta')
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'connection_error')
            syncStateRec.set('last_error', conMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: effectivePullUrl,
                error: String(pullAttempt.error),
                attempts: pullAttempt.attempts,
                checked_at: new Date().toISOString(),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(502, {
          success: false,
          status: 'connection_error',
          message: conMsg,
          pulled: 0,
          pushed: 0,
          errors: [conMsg],
        })
      }

      var isHtml = isHtmlContent(pullRes.raw)
      if (isHtml || pullRes.statusCode === 404 || pullRes.statusCode === 405) {
        if (RECOMMENDED_URL && effectivePullUrl !== RECOMMENDED_URL) {
          $app
            .logger()
            .warn(
              'agenda_sync POST: configured URL returned HTML or 404 (' +
                pullRes.statusCode +
                '). Trying fallback to RECOMMENDED_URL.',
              'url',
              effectivePullUrl,
            )
          var fbAttempt = fetchWithRetry(RECOMMENDED_URL, headers, 1)
          if (
            fbAttempt.res &&
            fbAttempt.res.statusCode === 200 &&
            !isHtmlContent(fbAttempt.res.raw)
          ) {
            pullRes = fbAttempt.res
            effectivePullUrl = RECOMMENDED_URL
            effectiveBaseUrl = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
            usedFallback = true
            isHtml = false
            $app.logger().info('agenda_sync POST: fallback to RECOMMENDED_URL succeeded!')
          }
        }
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
                url: effectivePullUrl,
                status: pullRes.statusCode,
                raw: (pullRes.raw || '').slice(0, 500),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(401, {
          success: false,
          status: 'auth_failed',
          message: authErrMsg,
          pulled: 0,
          pushed: 0,
          errors: [authErrMsg],
        })
      }

      if (isHtml) {
        var wrongUrlMsg =
          'A URL configurada (' +
          (cfg.rawConfiguredUrl || cfg.pullUrl) +
          ') aponta para o SITE da agenda, não para o BACKEND dela. Troque o secret AGENDA_SYNC_URL para ' +
          RECOMMENDED_URL
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'wrong_url')
            syncStateRec.set('last_error', wrongUrlMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: cfg.pullUrl,
                recommended_url: RECOMMENDED_URL,
                status: pullRes.statusCode,
                content_type_hint: 'HTML_DETECTED',
                raw: (pullRes.raw || '').slice(0, 300),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(400, {
          success: false,
          status: 'wrong_url',
          message: wrongUrlMsg,
          pulled: 0,
          pushed: 0,
          errors: [wrongUrlMsg],
        })
      }

      if (pullRes.statusCode === 400 || (pullRes.statusCode >= 500 && pullRes.statusCode <= 599)) {
        var extErrMsg =
          'O backend da agenda respondeu com erro interno (HTTP ' +
          pullRes.statusCode +
          '). O problema está no projeto da AGENDA (endpoint crm-dados), não no CRM. O /api/health dele está OK. Corrija o endpoint no projeto da agenda ou peça para o suporte da agenda verificar.'
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', 'external_error')
            syncStateRec.set('last_error', extErrMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: effectivePullUrl,
                status: pullRes.statusCode,
                classification: 'external_error',
                raw: (pullRes.raw || '').slice(0, 500),
                attempts: pullAttempt.attempts,
                checked_at: new Date().toISOString(),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(502, {
          success: false,
          status: 'external_error',
          message: extErrMsg,
          pulled: 0,
          pushed: 0,
          errors: [extErrMsg],
        })
      }

      if (pullRes.statusCode !== 200) {
        var is404or405 = pullRes.statusCode === 404 || pullRes.statusCode === 405
        var httpErrMsg = is404or405
          ? 'URL incorreta ou rota inexistente na agenda externa (HTTP ' +
            pullRes.statusCode +
            '). Troque o secret AGENDA_SYNC_URL para ' +
            RECOMMENDED_URL
          : 'Resposta inesperada do endpoint crm-dados (HTTP ' +
            pullRes.statusCode +
            '): ' +
            (pullRes.raw || '').slice(0, 300)
        var st = is404or405 ? 'wrong_url' : 'error'
        if (syncStateRec) {
          try {
            syncStateRec.set('last_status', st)
            syncStateRec.set('last_error', httpErrMsg)
            syncStateRec.set(
              'details',
              JSON.stringify({
                url: effectivePullUrl,
                status: pullRes.statusCode,
                raw: (pullRes.raw || '').slice(0, 500),
              }),
            )
            $app.save(syncStateRec)
          } catch (_) {}
        }
        return e.json(502, {
          success: false,
          status: st,
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

        if (pendingPush.length > 0 && effectiveBaseUrl) {
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

            var pushUrl = effectiveBaseUrl + '/backend/v1/agenda/agendamentos'
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
              pull_url: effectivePullUrl,
              configured_url: cfg.pullUrl,
              used_fallback: usedFallback,
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
        message:
          finalStatus === 'success'
            ? 'Sincronização concluída com sucesso (' +
              pulledCount +
              ' agendamentos importados)' +
              (usedFallback ? ' via fallback na URL recomendada.' : '.')
            : 'Sincronização finalizada com avisos/pendências (' + syncErrors.length + ' erro(s)).',
        pulled: pulledCount,
        pulled_contacts: pulledContactsCount,
        pushed: pushedCount,
        errors: syncErrors,
        used_fallback: usedFallback,
        pull_url: effectivePullUrl,
      })
    } catch (err) {
      $app.logger().error('agenda_sync: error in /backend/v1/agenda/sync', 'error', String(err))
      return e.json(500, {
        success: false,
        status: 'internal_error',
        message: 'Erro interno ao sincronizar agenda: ' + String(err),
      })
    }
  },
  $apis.activityLogger(),
)

// 3. ENDPOINT DE STATUS E DIAGNÓSTICO
routerAdd(
  'GET',
  '/backend/v1/agenda/sync-status',
  (e) => {
    try {
      function formatBRDate(d) {
        var day = String(d.getDate())
        if (day.length < 2) day = '0' + day
        var month = String(d.getMonth() + 1)
        if (month.length < 2) month = '0' + month
        var year = d.getFullYear()
        return day + '/' + month + '/' + year
      }

      function getDefaultSyncDates() {
        var now = new Date()
        var past6m = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
        var future2m = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
        return {
          data_inicio: formatBRDate(past6m),
          data_fim: formatBRDate(future2m),
        }
      }

      function buildDateQuery(dates) {
        var d = dates || getDefaultSyncDates()
        return (
          'data_inicio=' +
          encodeURIComponent(d.data_inicio) +
          '&data_fim=' +
          encodeURIComponent(d.data_fim)
        )
      }

      var defaultDates = getDefaultSyncDates()
      var RECOMMENDED_URL =
        'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev/backend/v1/crm-dados?tipo=tudo&' +
        buildDateQuery(defaultDates)

      function isHtmlContent(raw) {
        if (!raw) return false
        var trimmed = String(raw).trim()
        if (trimmed.startsWith('<')) return true
        var lower = trimmed.toLowerCase()
        return lower.indexOf('<!doctype') !== -1 || lower.indexOf('<html') !== -1
      }

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
            rawConfiguredUrl: '',
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

        if (pullUrl.indexOf('data_inicio=') === -1 || pullUrl.indexOf('data_fim=') === -1) {
          var dQuery = buildDateQuery(defaultDates)
          pullUrl += (pullUrl.indexOf('?') === -1 ? '?' : '&') + dQuery
        }

        return {
          configured: Boolean(pullUrl && rawToken),
          baseUrl: baseUrl,
          pullUrl: pullUrl,
          token: rawToken,
          missing: [],
          rawConfiguredUrl: rawUrl,
        }
      }

      var cfg = getAgendaConfig()
      var syncKey = 'agenda_externa_dr_caio'

      var stateRec = null
      try {
        stateRec = $app.findFirstRecordByFilter('sync_state', 'key = {:k}', { k: syncKey })
      } catch (_) {}

      var recDetails = {}
      if (stateRec && stateRec.getString('details')) {
        try {
          recDetails = JSON.parse(stateRec.getString('details'))
        } catch (_) {}
      }

      var counts = {
        total: 0,
        agenda_externa: 0,
        crm: 0,
        pending_push: 0,
        sync_errors: 0,
      }

      try {
        var allAppts = $app.findRecordsByFilter('appointments', '1=1', '', 500, 0)
        counts.total = allAppts.length
        for (var i = 0; i < allAppts.length; i++) {
          var a = allAppts[i]
          var src = a.getString('source')
          if (src === 'agenda_externa') counts.agenda_externa++
          else if (src === 'crm') counts.crm++

          if (
            src === 'crm' &&
            (!a.getString('last_synced_at') ||
              a.getString('updated') > a.getString('last_synced_at'))
          ) {
            counts.pending_push++
          }
          if (a.getString('sync_error')) {
            counts.sync_errors++
          }
        }
      } catch (_) {}

      var diagnostic = {
        configured: cfg.configured,
        missing_envs: cfg.missing,
        pull_url: cfg.pullUrl,
        recommended_url: RECOMMENDED_URL,
        url_is_recommended: cfg.pullUrl === RECOMMENDED_URL,
        url_is_site_frontend: false,
        last_tested_status: null,
        classification: 'unknown',
        explanation: '',
        raw_snippet: '',
      }

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
            timeout: 10,
          })

          diagnostic.last_tested_status = testRes.statusCode
          diagnostic.raw_snippet = (testRes.raw || '').slice(0, 300)

          var testIsHtml = isHtmlContent(testRes.raw)
          diagnostic.url_is_site_frontend = testIsHtml

          if (testRes.statusCode === 200 && !testIsHtml) {
            diagnostic.classification = 'ok'
            diagnostic.explanation =
              'Endpoint respondendo com sucesso (HTTP 200 JSON). Sincronia 100% operacional.'
          } else if (testIsHtml || testRes.statusCode === 404 || testRes.statusCode === 405) {
            diagnostic.classification = 'wrong_url'
            diagnostic.explanation =
              'A URL configurada (' +
              (cfg.rawConfiguredUrl || cfg.pullUrl) +
              ') aponta para o SITE da agenda, não para o BACKEND dela. Troque o secret AGENDA_SYNC_URL para ' +
              RECOMMENDED_URL
          } else if (testRes.statusCode === 401 || testRes.statusCode === 403) {
            diagnostic.classification = 'invalid_token'
            diagnostic.explanation =
              'Token de acesso rejeitado (HTTP ' +
              testRes.statusCode +
              '). Verifique AGENDA_CRM_TOKEN.'
          } else if (
            testRes.statusCode === 400 ||
            (testRes.statusCode >= 500 && testRes.statusCode <= 599)
          ) {
            diagnostic.classification = 'external_error'
            diagnostic.explanation =
              'O backend da agenda respondeu com erro interno (HTTP ' +
              testRes.statusCode +
              '). O problema está no projeto da AGENDA (endpoint crm-dados), não no CRM. O /api/health dele está OK. Corrija o endpoint no projeto da agenda ou peça para o suporte da agenda verificar.'
          } else {
            diagnostic.classification = 'unexpected_response'
            diagnostic.explanation =
              'Resposta inesperada do endpoint crm-dados (HTTP ' + testRes.statusCode + ').'
          }
        } catch (diagErr) {
          diagnostic.classification = 'connection_error'
          diagnostic.explanation =
            'Não foi possível conectar ao endpoint da agenda externa: ' + String(diagErr)
        }
      } else {
        diagnostic.classification = 'missing_credentials'
        diagnostic.explanation =
          'Sincronia não configurada: faltam credenciais (' + cfg.missing.join(', ') + ')'
      }

      var recCheck = {
        tested: false,
        status_code: null,
        classification: 'unknown',
        explanation: '',
        raw_snippet: '',
      }

      if (RECOMMENDED_URL) {
        recCheck.tested = true
        try {
          var recRes = $http.send({
            url: RECOMMENDED_URL,
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-CRM-Token': cfg.token,
              Authorization: 'Bearer ' + cfg.token,
            },
            timeout: 10,
          })
          recCheck.status_code = recRes.statusCode
          recCheck.raw_snippet = (recRes.raw || '').slice(0, 300)
          var recIsHtml = isHtmlContent(recRes.raw)
          if (recRes.statusCode === 200 && !recIsHtml) {
            recCheck.classification = 'ok'
            recCheck.explanation =
              'A URL recomendada respondeu HTTP 200 JSON com sucesso! Troque seu secret AGENDA_SYNC_URL para ela.'
          } else if (
            recRes.statusCode === 400 ||
            (recRes.statusCode >= 500 && recRes.statusCode <= 599)
          ) {
            recCheck.classification = 'external_error'
            recCheck.explanation =
              'A URL recomendada respondeu HTTP ' +
              recRes.statusCode +
              '. O backend da agenda externa precisa de correção no endpoint crm-dados.'
          } else if (recRes.statusCode === 401 || recRes.statusCode === 403) {
            recCheck.classification = 'invalid_token'
            recCheck.explanation =
              'A URL recomendada foi alcançada mas rejeitou o token (HTTP ' +
              recRes.statusCode +
              ').'
          } else {
            recCheck.classification = 'error'
            recCheck.explanation =
              'A URL recomendada retornou status HTTP ' + recRes.statusCode + '.'
          }
        } catch (recErr) {
          recCheck.classification = 'connection_error'
          recCheck.explanation = 'Falha de rede ao testar URL recomendada: ' + String(recErr)
        }
      }

      return e.json(200, {
        configured: cfg.configured,
        sync_enabled: true,
        last_sync: stateRec ? stateRec.getString('last_sync') : null,
        last_status: stateRec ? stateRec.getString('last_status') : 'not_synced',
        last_error: stateRec ? stateRec.getString('last_error') : null,
        details: recDetails,
        counts: counts,
        diagnostic: diagnostic,
        recommended_url_check: recCheck,
        cron_schedule: 'A cada 2 minutos',
        direction: 'bidirectional (pull + push)',
      })
    } catch (err) {
      $app
        .logger()
        .error('agenda_sync: error in /backend/v1/agenda/sync-status', 'error', String(err))
      return e.json(500, {
        error: String(err),
      })
    }
  },
  $apis.activityLogger(),
)
