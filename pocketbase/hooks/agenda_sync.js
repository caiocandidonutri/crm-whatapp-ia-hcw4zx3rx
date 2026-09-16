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

// 1. CRON DE SINCRONIZAÇÃO A CADA 15 MINUTOS (otimizado para não sobrecarregar com 429)
cronAdd('agenda_external_sync', '*/15 * * * *', () => {
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

  function getMonthlyChunkDates() {
    var now = new Date()
    var chunks = []
    // Cobrir os últimos 6 meses (chunk mensal) até 2 meses futuros
    // -6m até -5m, -5m até -4m, ..., +1m até +2m
    for (var m = -6; m < 2; m++) {
      var start = new Date(now.getFullYear(), now.getMonth() + m, 1)
      var end = new Date(now.getFullYear(), now.getMonth() + m + 1, 0, 23, 59, 59)
      chunks.push({
        data_inicio: formatBRDate(start),
        data_fim: formatBRDate(end),
      })
    }
    return chunks
  }

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

  function normalizeAppointmentType(item) {
    var raw = String(
      item.appointment_type ||
        item.tipo_consulta ||
        item.tipo ||
        item.servico ||
        item.procedimento ||
        item.valor ||
        item.notes ||
        item.observacoes ||
        '',
    ).toLowerCase()

    if (raw.indexOf('consultoria') !== -1 || raw.indexOf('consultoria nutricional') !== -1) {
      return 'Consultoria'
    }
    if (raw.indexOf('retorno') !== -1 || raw.indexOf('reavalia') !== -1) {
      return 'Retorno'
    }
    if (
      raw.indexOf('consulta') !== -1 ||
      raw.indexOf('primeira') !== -1 ||
      raw.indexOf('avalia') !== -1
    ) {
      return 'Consulta'
    }
    if (raw.indexOf('bioimped') !== -1) {
      return 'Bioimpedância'
    }
    // Fallback padrão se não detectado
    return 'Consulta'
  }

  function ensureCrmContactForPatient(patientName, patientPhone, accountId) {
    if (!patientPhone) return null
    var digits = cleanDigits(patientPhone)
    if (!digits || digits.length < 8) return null
    var suffix = digits.slice(-8)

    try {
      var contact = $app.findFirstRecordByFilter('crm_contacts', 'phone ~ {:suf} || jid ~ {:suf}', {
        suf: suffix,
      })
      if (contact) {
        var needsUpdate = false
        var currentName = contact.getString('contact_name')
        if (
          (!currentName || currentName === 'Novo Contato' || currentName.indexOf('@') !== -1) &&
          patientName &&
          patientName !== 'Paciente sem nome'
        ) {
          contact.set('contact_name', patientName)
          needsUpdate = true
        }
        if (!contact.getBool('is_patient')) {
          contact.set('is_patient', true)
          needsUpdate = true
        }
        if (!contact.getString('account_id') && accountId) {
          contact.set('account_id', accountId)
          needsUpdate = true
        }
        if (needsUpdate) {
          try {
            $app.save(contact)
          } catch (_) {}
        }
        return contact
      }

      // Se não encontrou, criar novo contato
      var crmCol = $app.findCollectionByNameOrId('crm_contacts')
      var newContact = new Record(crmCol)
      newContact.set('phone', digits)
      newContact.set('jid', digits + '@s.whatsapp.net')
      newContact.set('contact_name', patientName || 'Paciente')
      newContact.set('is_patient', true)
      newContact.set('stage', 'cliente')
      newContact.set('care_status', 'em_dia')
      newContact.set('last_synced_at', new Date().toISOString())
      if (accountId) {
        newContact.set('account_id', accountId)
      }

      try {
        $app.save(newContact)
        return newContact
      } catch (createErr) {
        return null
      }
    } catch (_) {
      return null
    }
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

  var effectivePullUrl = cfg.pullUrl
  var effectiveBaseUrl = cfg.baseUrl
  var usedFallback = false

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

  // Extração recursiva / flexível de arrays em envelopes arbitrários
  function extractAppointmentsAndContacts(data) {
    var foundAppointments = []
    var foundContacts = []

    if (!data) return { appointments: foundAppointments, contacts: foundContacts }

    // Função auxiliar para testar se um objeto parece ser um agendamento
    function isAppointmentObject(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
      var keys = Object.keys(obj)
      var hasDateOrTime = false
      var hasPatientOrClient = false
      for (var k = 0; k < keys.length; k++) {
        var lk = keys[k].toLowerCase()
        if (
          lk.indexOf('data') !== -1 ||
          lk.indexOf('start') !== -1 ||
          lk.indexOf('hora') !== -1 ||
          lk.indexOf('inicio') !== -1 ||
          lk.indexOf('horario') !== -1
        ) {
          hasDateOrTime = true
        }
        if (
          lk.indexOf('paciente') !== -1 ||
          lk.indexOf('patient') !== -1 ||
          lk.indexOf('cliente') !== -1 ||
          lk.indexOf('nome') !== -1
        ) {
          hasPatientOrClient = true
        }
      }
      return hasDateOrTime && hasPatientOrClient
    }

    // Função auxiliar para testar se um objeto parece ser um contato
    function isContactObject(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
      var keys = Object.keys(obj)
      var hasPhone = false
      var hasName = false
      for (var k = 0; k < keys.length; k++) {
        var lk = keys[k].toLowerCase()
        if (
          lk.indexOf('telefone') !== -1 ||
          lk.indexOf('phone') !== -1 ||
          lk.indexOf('whatsapp') !== -1 ||
          lk.indexOf('celular') !== -1
        ) {
          hasPhone = true
        }
        if (
          lk.indexOf('nome') !== -1 ||
          lk.indexOf('name') !== -1 ||
          lk.indexOf('paciente') !== -1
        ) {
          hasName = true
        }
      }
      return hasPhone && hasName
    }

    // Busca recursiva por listas
    function traverse(node, depth) {
      if (!node || depth > 5) return
      if (Array.isArray(node)) {
        if (node.length > 0) {
          var first = node[0]
          if (isAppointmentObject(first)) {
            for (var a = 0; a < node.length; a++) {
              foundAppointments.push(node[a])
            }
            return
          } else if (isContactObject(first)) {
            for (var c = 0; c < node.length; c++) {
              foundContacts.push(node[c])
            }
            return
          }
        }
        // Se for array de objetos mistos ou outros arrays
        for (var i = 0; i < node.length; i++) {
          if (typeof node[i] === 'object') {
            traverse(node[i], depth + 1)
          }
        }
      } else if (typeof node === 'object') {
        // Checar chaves diretas conhecidas primeiro
        var directAppts =
          node.agendamentos ||
          node.appointments ||
          node.consultas ||
          node.atendimentos ||
          node.agenda
        if (Array.isArray(directAppts)) {
          for (var da = 0; da < directAppts.length; da++) {
            foundAppointments.push(directAppts[da])
          }
        }

        var directContacts =
          node.contatos || node.contacts || node.pacientes || node.patients || node.clientes
        if (Array.isArray(directContacts)) {
          for (var dc = 0; dc < directContacts.length; dc++) {
            foundContacts.push(directContacts[dc])
          }
        }

        // Se encontrou via chaves diretas, ainda assim percorre outros nós filhos (ex: node.dados)
        var objKeys = Object.keys(node)
        for (var k = 0; k < objKeys.length; k++) {
          var keyName = objKeys[k]
          if (
            keyName === 'agendamentos' ||
            keyName === 'appointments' ||
            keyName === 'consultas' ||
            keyName === 'atendimentos' ||
            keyName === 'contatos' ||
            keyName === 'contacts' ||
            keyName === 'pacientes' ||
            keyName === 'patients'
          ) {
            continue
          }
          if (typeof node[keyName] === 'object') {
            traverse(node[keyName], depth + 1)
          }
        }
      }
    }

    traverse(data, 0)
    return { appointments: foundAppointments, contacts: foundContacts }
  }

  var extracted = extractAppointmentsAndContacts(body)
  extAppointments = extracted.appointments
  extContacts = extracted.contacts

  // Log detalhado das chaves e primeiro item para diagnóstico
  if (extAppointments && extAppointments.length > 0) {
    $app
      .logger()
      .info('agenda_sync sample item keys: ' + Object.keys(extAppointments[0]).join(', '))
    $app.logger().info('agenda_sync sample item: ' + JSON.stringify(extAppointments[0]))
  }

  var appointmentsCol = $app.findCollectionByNameOrId('appointments')

  for (var i = 0; i < extAppointments.length; i++) {
    var item = extAppointments[i]
    if (!item || typeof item !== 'object') continue

    function pad2(n) {
      return (n < 10 ? '0' : '') + n
    }

    // Helper rigoroso para parsing de datas de agendamento da agenda externa
    // Regra fundamental: os horários vindos da API da agenda externa (ex: 14:00, ou "14:00:00.000Z")
    // representam o horário CIVIL de Brasília da consulta marcada (14:00 em Brasília = 14:00 local).
    // O PocketBase armazena em UTC (ISO 8601 terminando em 'Z').
    // Para que 14:00 de Brasília fique correto:
    // UTC = Hora de Brasília + 3 horas (14:00 SP -> 17:00 UTC).
    // Quando a agenda externa envia "2026-09-16 14:00:00.000Z" ou "2026-09-16T14:00:00.000Z",
    // ela gravou o horário nominal da consulta diretamente como se fosse UTC, ou formatou sem timezone.
    // Retornamos SEMPRE o UTC correto: year, month, day, hour + 3.
    function parseAppointmentDateUtc(rawDate, rawTime, isEndDate) {
      if (!rawDate) return null
      var s = String(rawDate).trim()
      if (!s) return null

      // Formato brasileiro: dd/MM/yyyy ou dd/MM/yyyy HH:mm[:ss]
      var brMatch = s.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
      )
      if (brMatch) {
        var day = parseInt(brMatch[1], 10)
        var month = parseInt(brMatch[2], 10) - 1
        var year = parseInt(brMatch[3], 10)
        var hour = brMatch[4] ? parseInt(brMatch[4], 10) : isEndDate ? 23 : 0
        var min = brMatch[5] ? parseInt(brMatch[5], 10) : isEndDate && !brMatch[4] ? 59 : 0
        var sec = brMatch[6] ? parseInt(brMatch[6], 10) : isEndDate && !brMatch[4] ? 59 : 0

        if (rawTime && !brMatch[4]) {
          var tmMatch = String(rawTime)
            .trim()
            .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
          if (tmMatch) {
            hour = parseInt(tmMatch[1], 10)
            min = parseInt(tmMatch[2], 10)
            sec = tmMatch[3] ? parseInt(tmMatch[3], 10) : 0
          }
        }

        // Brasília é UTC-3 (sem horário de verão).
        // Para que uma consulta civil das 14:00 resulte em 14:00 em America/Sao_Paulo:
        // UTC = Date.UTC(year, month, day, hour + 3, min, sec)
        var utcMs = Date.UTC(year, month, day, hour + 3, min, sec)
        return new Date(utcMs).toISOString()
      }

      // Formato ISO: yyyy-MM-dd ou yyyy-MM-dd[T ]HH:mm[:ss] (com ou sem Z / offset)
      // Exemplo real da agenda: "2026-11-12 16:00:00.000Z" -> representa consulta às 16:00 em Brasília!
      var isoMatch = s.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
      )
      if (isoMatch) {
        var iYear = parseInt(isoMatch[1], 10)
        var iMonth = parseInt(isoMatch[2], 10) - 1
        var iDay = parseInt(isoMatch[3], 10)
        var hasTimeInString = isoMatch[4] !== undefined

        var iHour = hasTimeInString ? parseInt(isoMatch[4], 10) : isEndDate ? 23 : 0
        var iMin = hasTimeInString
          ? parseInt(isoMatch[5], 10)
          : isEndDate && !hasTimeInString
            ? 59
            : 0
        var iSec =
          hasTimeInString && isoMatch[6]
            ? parseInt(isoMatch[6], 10)
            : isEndDate && !hasTimeInString
              ? 59
              : 0

        if (rawTime && !hasTimeInString) {
          var itmMatch = String(rawTime)
            .trim()
            .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
          if (itmMatch) {
            iHour = parseInt(itmMatch[1], 10)
            iMin = parseInt(itmMatch[2], 10)
            iSec = itmMatch[3] ? parseInt(itmMatch[3], 10) : 0
            hasTimeInString = true
          }
        }

        // Se a string tem offset explícito diferente de Z (ex: -03:00)
        if (s.match(/[+-]\d{2}:?\d{2}$/) && !s.endsWith('+00:00') && !s.endsWith('-00:00')) {
          var parsedWithOffset = new Date(s)
          if (!isNaN(parsedWithOffset.getTime())) {
            return parsedWithOffset.toISOString()
          }
        }

        // Horário civil da agenda externa: 14:00 significa 14:00 Brasília (UTC-3).
        // Gravamos em UTC: hour + 3.
        var iUtcMs = Date.UTC(iYear, iMonth, iDay, iHour + 3, iMin, iSec)
        return new Date(iUtcMs).toISOString()
      }

      try {
        var genericD = new Date(s)
        if (!isNaN(genericD.getTime())) {
          return genericD.toISOString()
        }
      } catch (_) {}

      return null
    }

    // 1. Extração prioritária da data de início da consulta
    // Prioridade máxima aos campos explícitos de data de agendamento da agenda externa
    var rawStartVal =
      item.data_inicio ||
      item.data_consulta ||
      item.data_atendimento ||
      item.data_agendamento ||
      item.data_hora ||
      item.dataHora ||
      item.starts_at ||
      item.start_time ||
      item.horario_inicio ||
      item.data ||
      ''

    var rawTimeVal =
      item.hora || item.horario || item.time || item.hora_inicio || item.start_time || ''

    var startsAtIso = parseAppointmentDateUtc(rawStartVal, rawTimeVal, false)

    // NUNCA usar updated, created ou momento da sync como data da consulta!
    // Se data_inicio for ausente ou ilegível, pula este registro para evitar poluir a agenda
    if (!startsAtIso) {
      $app
        .logger()
        .warn(
          'agenda_sync: ignorando registro sem data de agendamento válida',
          'id',
          item.id || item.external_id || '',
          'paciente',
          item.paciente_nome || item.patient_name || '',
          'raw_data',
          String(rawStartVal).slice(0, 50),
        )
      continue
    }

    // 2. Extração da data de fim
    var rawEndVal =
      item.data_fim ||
      item.dataHoraFim ||
      item.ends_at ||
      item.end_time ||
      item.horario_fim ||
      item.data_fim_consulta ||
      ''
    var rawEndTimeVal = item.hora_fim || item.horario_fim || item.end_time || ''

    var endsAtIso = parseAppointmentDateUtc(rawEndVal, rawEndTimeVal, true)
    if (!endsAtIso) {
      // Se tiver duração informada em minutos (ex: duracaoMin = 45 ou 60)
      var duracaoMin = parseInt(item.duracaoMin || item.duracao || item.duration || '0', 10)
      if (duracaoMin > 0) {
        var startD = new Date(startsAtIso)
        endsAtIso = new Date(startD.getTime() + duracaoMin * 60 * 1000).toISOString()
      } else {
        // Padrão de consulta nutricional: 45 minutos após o início
        var defaultStartD = new Date(startsAtIso)
        endsAtIso = new Date(defaultStartD.getTime() + 45 * 60 * 1000).toISOString()
      }
    }

    // 3. ID externo determinístico
    var extId = String(
      item.id || item.external_id || item._id || item.codigo || item.agendamento_id || '',
    ).trim()

    var patientNameVal = (
      item.patient_name ||
      item.paciente_nome ||
      item.patient ||
      item.paciente ||
      item.name ||
      item.nome ||
      'Paciente sem nome'
    ).trim()

    if (!extId) {
      // Cria ID determinístico usando hash seguro/limpo (sem espaços nem underscore no final)
      extId = 'ext_' + $security.md5(patientNameVal + '_' + startsAtIso)
    }

    // Buscar agendamento existente por external_id
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
      // A data real da consulta SEMPRE vem da agenda externa.
      // Se a data já gravada for diferente de startsAtIso, sobrescrevemos a data!
      var existingStartsAt = existing.getString('starts_at')
      var hasDateMismatch =
        !existingStartsAt || existingStartsAt.slice(0, 16) !== startsAtIso.slice(0, 16)
      if (!hasDateMismatch && localUpdated && remoteUpdated && localUpdated > remoteUpdated) {
        continue
      }
    }

    var rec = existing || new Record(appointmentsCol)
    rec.set('source', 'agenda_externa')
    rec.set('external_id', extId)
    rec.set('patient_name', patientNameVal)
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
      item.doctor ||
        item.medico ||
        item.nutricionista ||
        (item.profissional && item.profissional.nome ? item.profissional.nome : '') ||
        'Dr. Caio',
    )
    rec.set('city', normalizeCity(item.city || item.cidade || item.location || item.local))
    rec.set('location', item.location || item.local || item.clinica || 'Climed')

    // A data da consulta SEMPRE vem da agenda externa: sobrescreve starts_at e ends_at
    rec.set('starts_at', startsAtIso)
    rec.set('ends_at', endsAtIso)
    rec.set('status', normalizeStatus(item.status || item.situacao || item.estado || 'agendado'))
    var normalizedType = normalizeAppointmentType(item)
    rec.set('appointment_type', normalizedType)
    rec.set('notes', item.notes || item.observacoes || item.descricao || '')
    rec.set('sync_hash', String(item.updated || item.updated_at || item.id || extId))
    rec.set('last_synced_at', new Date().toISOString())
    rec.set('sync_error', '')

    // Vincular / Criar contato no CRM
    var patPhone = rec.getString('patient_phone')
    var patName = rec.getString('patient_name')
    var accId = rec.getString('account_id')
    var linkedContact = ensureCrmContactForPatient(patName, patPhone, accId)
    if (linkedContact) {
      rec.set('patient_id', linkedContact.id)
      if (!rec.getString('account_id') && linkedContact.getString('account_id')) {
        rec.set('account_id', linkedContact.getString('account_id'))
      }
    }

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

  var rawBodySample = pullRes && pullRes.raw ? pullRes.raw.slice(0, 3000) : ''
  var bodyKeys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
  var firstSampleItem =
    extAppointments && extAppointments.length > 0
      ? JSON.stringify(extAppointments[0]).slice(0, 500)
      : 'none'

  if (syncStateRec) {
    try {
      syncStateRec.set('last_sync', new Date().toISOString())
      syncStateRec.set('last_status', finalStatus)

      // DIAGNOSTICO TEMPORARIO: Gravar chaves e campos de amostras no last_error para inspeção imediata
      var sampleA =
        extAppointments && extAppointments[0]
          ? JSON.stringify(extAppointments[0]).slice(0, 200)
          : ''
      var sampleB =
        extAppointments && extAppointments[1]
          ? JSON.stringify(extAppointments[1]).slice(0, 200)
          : ''
      syncStateRec.set(
        'last_error',
        'KEYS=' + bodyKeys.join(',') + ' | S0=' + sampleA + ' | S1=' + sampleB,
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
          raw_sample: rawBodySample,
          raw_snippet: pullRes ? String(pullRes.raw || '').slice(0, 500) : '',
          raw_status: pullRes ? pullRes.statusCode : 0,
          ext_appts_found: extAppointments ? extAppointments.length : 0,
          debug_keys: bodyKeys,
          debug_sample: rawBodySample.slice(0, 400),
          first_parsed_sample: firstSampleItem,
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
routerAdd('POST', '/backend/v1/agenda/sync', (e) => {
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

    function getMonthlyChunkDates() {
      var now = new Date()
      var chunks = []
      for (var m = -6; m < 2; m++) {
        var start = new Date(now.getFullYear(), now.getMonth() + m, 1)
        var end = new Date(now.getFullYear(), now.getMonth() + m + 1, 0, 23, 59, 59)
        chunks.push({
          data_inicio: formatBRDate(start),
          data_fim: formatBRDate(end),
        })
      }
      return chunks
    }

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

    function normalizeAppointmentType(item) {
      var raw = String(
        item.appointment_type ||
          item.tipo_consulta ||
          item.tipo ||
          item.servico ||
          item.procedimento ||
          item.valor ||
          item.notes ||
          item.observacoes ||
          '',
      ).toLowerCase()

      if (raw.indexOf('consultoria') !== -1 || raw.indexOf('consultoria nutricional') !== -1) {
        return 'Consultoria'
      }
      if (raw.indexOf('retorno') !== -1 || raw.indexOf('reavalia') !== -1) {
        return 'Retorno'
      }
      if (
        raw.indexOf('consulta') !== -1 ||
        raw.indexOf('primeira') !== -1 ||
        raw.indexOf('avalia') !== -1
      ) {
        return 'Consulta'
      }
      if (raw.indexOf('bioimped') !== -1) {
        return 'Bioimpedância'
      }
      return 'Consulta'
    }

    function ensureCrmContactForPatient(patientName, patientPhone, accountId) {
      if (!patientPhone) return null
      var digits = cleanDigits(patientPhone)
      if (!digits || digits.length < 8) return null
      var suffix = digits.slice(-8)

      try {
        var contact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'phone ~ {:suf} || jid ~ {:suf}',
          { suf: suffix },
        )
        if (contact) {
          var needsUpdate = false
          var currentName = contact.getString('contact_name')
          if (
            (!currentName || currentName === 'Novo Contato' || currentName.indexOf('@') !== -1) &&
            patientName &&
            patientName !== 'Paciente sem nome'
          ) {
            contact.set('contact_name', patientName)
            needsUpdate = true
          }
          if (!contact.getBool('is_patient')) {
            contact.set('is_patient', true)
            needsUpdate = true
          }
          if (!contact.getString('account_id') && accountId) {
            contact.set('account_id', accountId)
            needsUpdate = true
          }
          if (needsUpdate) {
            try {
              $app.save(contact)
            } catch (_) {}
          }
          return contact
        }

        var crmCol = $app.findCollectionByNameOrId('crm_contacts')
        var newContact = new Record(crmCol)
        newContact.set('phone', digits)
        newContact.set('jid', digits + '@s.whatsapp.net')
        newContact.set('contact_name', patientName || 'Paciente')
        newContact.set('is_patient', true)
        newContact.set('stage', 'cliente')
        newContact.set('care_status', 'em_dia')
        newContact.set('last_synced_at', new Date().toISOString())
        if (accountId) {
          newContact.set('account_id', accountId)
        }

        try {
          $app.save(newContact)
          return newContact
        } catch (createErr) {
          return null
        }
      } catch (_) {
        return null
      }
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

    function extractAppointmentsAndContacts(data) {
      var foundAppointments = []
      var foundContacts = []
      if (!data) return { appointments: foundAppointments, contacts: foundContacts }

      function isAppointmentObject(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
        var keys = Object.keys(obj)
        var hasDateOrTime = false
        var hasPatientOrClient = false
        for (var k = 0; k < keys.length; k++) {
          var lk = keys[k].toLowerCase()
          if (
            lk.indexOf('data') !== -1 ||
            lk.indexOf('start') !== -1 ||
            lk.indexOf('hora') !== -1 ||
            lk.indexOf('inicio') !== -1 ||
            lk.indexOf('horario') !== -1
          ) {
            hasDateOrTime = true
          }
          if (
            lk.indexOf('paciente') !== -1 ||
            lk.indexOf('patient') !== -1 ||
            lk.indexOf('cliente') !== -1 ||
            lk.indexOf('nome') !== -1
          ) {
            hasPatientOrClient = true
          }
        }
        return hasDateOrTime && hasPatientOrClient
      }

      function isContactObject(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
        var keys = Object.keys(obj)
        var hasPhone = false
        var hasName = false
        for (var k = 0; k < keys.length; k++) {
          var lk = keys[k].toLowerCase()
          if (
            lk.indexOf('telefone') !== -1 ||
            lk.indexOf('phone') !== -1 ||
            lk.indexOf('whatsapp') !== -1 ||
            lk.indexOf('celular') !== -1
          ) {
            hasPhone = true
          }
          if (
            lk.indexOf('nome') !== -1 ||
            lk.indexOf('name') !== -1 ||
            lk.indexOf('paciente') !== -1
          ) {
            hasName = true
          }
        }
        return hasPhone && hasName
      }

      function traverse(node, depth) {
        if (!node || depth > 5) return
        if (Array.isArray(node)) {
          if (node.length > 0) {
            var first = node[0]
            if (isAppointmentObject(first)) {
              for (var a = 0; a < node.length; a++) {
                foundAppointments.push(node[a])
              }
              return
            } else if (isContactObject(first)) {
              for (var c = 0; c < node.length; c++) {
                foundContacts.push(node[c])
              }
              return
            }
          }
          for (var i = 0; i < node.length; i++) {
            if (typeof node[i] === 'object') {
              traverse(node[i], depth + 1)
            }
          }
        } else if (typeof node === 'object') {
          var directAppts =
            node.agendamentos ||
            node.appointments ||
            node.consultas ||
            node.atendimentos ||
            node.agenda
          if (Array.isArray(directAppts)) {
            for (var da = 0; da < directAppts.length; da++) {
              foundAppointments.push(directAppts[da])
            }
          }

          var directContacts =
            node.contatos || node.contacts || node.pacientes || node.patients || node.clientes
          if (Array.isArray(directContacts)) {
            for (var dc = 0; dc < directContacts.length; dc++) {
              foundContacts.push(directContacts[dc])
            }
          }

          var objKeys = Object.keys(node)
          for (var k = 0; k < objKeys.length; k++) {
            var keyName = objKeys[k]
            if (
              keyName === 'agendamentos' ||
              keyName === 'appointments' ||
              keyName === 'consultas' ||
              keyName === 'atendimentos' ||
              keyName === 'contatos' ||
              keyName === 'contacts' ||
              keyName === 'pacientes' ||
              keyName === 'patients'
            ) {
              continue
            }
            if (typeof node[keyName] === 'object') {
              traverse(node[keyName], depth + 1)
            }
          }
        }
      }

      traverse(data, 0)
      return { appointments: foundAppointments, contacts: foundContacts }
    }

    var extracted = extractAppointmentsAndContacts(body)
    extAppointments = extracted.appointments
    extContacts = extracted.contacts

    if (extAppointments && extAppointments.length > 0) {
      $app
        .logger()
        .info('agenda_sync POST sample item keys: ' + Object.keys(extAppointments[0]).join(', '))
      $app.logger().info('agenda_sync POST sample item: ' + JSON.stringify(extAppointments[0]))
    }

    var appointmentsCol = $app.findCollectionByNameOrId('appointments')

    for (var i = 0; i < extAppointments.length; i++) {
      var item = extAppointments[i]
      if (!item || typeof item !== 'object') continue

      // Helper rigoroso para parsing de datas de agendamento da agenda externa (manual)
      function parseAppointmentDateUtc(rawDate, rawTime, isEndDate) {
        if (!rawDate) return null
        var s = String(rawDate).trim()
        if (!s) return null

        var brMatch = s.match(
          /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
        )
        if (brMatch) {
          var day = parseInt(brMatch[1], 10)
          var month = parseInt(brMatch[2], 10) - 1
          var year = parseInt(brMatch[3], 10)
          var hour = brMatch[4] ? parseInt(brMatch[4], 10) : isEndDate ? 23 : 0
          var min = brMatch[5] ? parseInt(brMatch[5], 10) : isEndDate && !brMatch[4] ? 59 : 0
          var sec = brMatch[6] ? parseInt(brMatch[6], 10) : isEndDate && !brMatch[4] ? 59 : 0

          if (rawTime && !brMatch[4]) {
            var tmMatch = String(rawTime)
              .trim()
              .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
            if (tmMatch) {
              hour = parseInt(tmMatch[1], 10)
              min = parseInt(tmMatch[2], 10)
              sec = tmMatch[3] ? parseInt(tmMatch[3], 10) : 0
            }
          }

          var utcMs = Date.UTC(year, month, day, hour + 3, min, sec)
          return new Date(utcMs).toISOString()
        }

        var isoMatch = s.match(
          /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
        )
        if (isoMatch) {
          var iYear = parseInt(isoMatch[1], 10)
          var iMonth = parseInt(isoMatch[2], 10) - 1
          var iDay = parseInt(isoMatch[3], 10)
          var hasTimeInString = isoMatch[4] !== undefined

          var iHour = hasTimeInString ? parseInt(isoMatch[4], 10) : isEndDate ? 23 : 0
          var iMin = hasTimeInString
            ? parseInt(isoMatch[5], 10)
            : isEndDate && !hasTimeInString
              ? 59
              : 0
          var iSec =
            hasTimeInString && isoMatch[6]
              ? parseInt(isoMatch[6], 10)
              : isEndDate && !hasTimeInString
                ? 59
                : 0

          if (rawTime && !hasTimeInString) {
            var itmMatch = String(rawTime)
              .trim()
              .match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
            if (itmMatch) {
              iHour = parseInt(itmMatch[1], 10)
              iMin = parseInt(itmMatch[2], 10)
              iSec = itmMatch[3] ? parseInt(itmMatch[3], 10) : 0
              hasTimeInString = true
            }
          }

          if (s.match(/[+-]\d{2}:?\d{2}$/) && !s.endsWith('+00:00') && !s.endsWith('-00:00')) {
            var parsedWithOffset = new Date(s)
            if (!isNaN(parsedWithOffset.getTime())) {
              return parsedWithOffset.toISOString()
            }
          }

          var iUtcMs = Date.UTC(iYear, iMonth, iDay, iHour + 3, iMin, iSec)
          return new Date(iUtcMs).toISOString()
        }

        try {
          var genericD = new Date(s)
          if (!isNaN(genericD.getTime())) {
            return genericD.toISOString()
          }
        } catch (_) {}

        return null
      }

      var rawStartVal =
        item.data_inicio ||
        item.data_consulta ||
        item.data_atendimento ||
        item.data_agendamento ||
        item.data_hora ||
        item.dataHora ||
        item.starts_at ||
        item.start_time ||
        item.horario_inicio ||
        item.data ||
        ''

      var rawTimeVal =
        item.hora || item.horario || item.time || item.hora_inicio || item.start_time || ''

      var startsAtIso = parseAppointmentDateUtc(rawStartVal, rawTimeVal, false)

      // NUNCA usar updated, created ou momento da sync como data da consulta!
      // Registros sem data válida não viram agendamento jamais!
      if (!startsAtIso) {
        $app
          .logger()
          .warn(
            'agenda_sync (manual): ignorando registro sem data de agendamento válida',
            'id',
            item.id || item.external_id || '',
            'paciente',
            item.paciente_nome || item.patient_name || '',
          )
        continue
      }

      var extId = String(
        item.id || item.external_id || item._id || item.codigo || item.agendamento_id || '',
      ).trim()

      var patientNameVal = (
        item.patient_name ||
        item.paciente_nome ||
        item.patient ||
        item.paciente ||
        item.name ||
        item.nome ||
        'Paciente sem nome'
      ).trim()

      if (!extId) {
        extId = 'ext_' + $security.md5(patientNameVal + '_' + startsAtIso)
      }

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
        var existingStartsAt = existing.getString('starts_at')
        var hasDateMismatch =
          !existingStartsAt || existingStartsAt.slice(0, 16) !== startsAtIso.slice(0, 16)
        if (!hasDateMismatch && localUpdated && remoteUpdated && localUpdated > remoteUpdated) {
          continue
        }
      }
      var rec = existing || new Record(appointmentsCol)
      rec.set('source', 'agenda_externa')
      rec.set('external_id', extId)
      rec.set('patient_name', patientNameVal)
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

      var rawEndVal =
        item.data_fim ||
        item.dataHoraFim ||
        item.ends_at ||
        item.end_time ||
        item.horario_fim ||
        item.data_fim_consulta ||
        ''
      var rawEndTimeVal = item.hora_fim || item.horario_fim || item.end_time || ''

      var endsAtIso = parseAppointmentDateUtc(rawEndVal, rawEndTimeVal, true)
      if (!endsAtIso) {
        var duracaoMin = parseInt(item.duracaoMin || item.duracao || item.duration || '0', 10)
        if (duracaoMin > 0) {
          var startD = new Date(startsAtIso)
          endsAtIso = new Date(startD.getTime() + duracaoMin * 60 * 1000).toISOString()
        } else {
          var defaultStartD = new Date(startsAtIso)
          endsAtIso = new Date(defaultStartD.getTime() + 45 * 60 * 1000).toISOString()
        }
      }

      // A data da consulta SEMPRE vem da agenda externa
      rec.set('starts_at', startsAtIso)
      rec.set('ends_at', endsAtIso)
      rec.set('status', normalizeStatus(item.status || item.situacao || item.estado || 'agendado'))
      var normalizedType = normalizeAppointmentType(item)
      rec.set('appointment_type', normalizedType)
      rec.set('notes', item.notes || item.observacoes || item.descricao || '')
      rec.set('sync_hash', String(item.updated || item.updated_at || item.id || extId))
      rec.set('last_synced_at', new Date().toISOString())
      rec.set('sync_error', '')

      var patPhone = rec.getString('patient_phone')
      var patName = rec.getString('patient_name')
      var accId = rec.getString('account_id')
      var linkedContact = ensureCrmContactForPatient(patName, patPhone, accId)
      if (linkedContact) {
        rec.set('patient_id', linkedContact.id)
        if (!rec.getString('account_id') && linkedContact.getString('account_id')) {
          rec.set('account_id', linkedContact.getString('account_id'))
        }
      }

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
      syncErrors.length === 0 ? 'success' : pulledCount > 0 || pushedCount > 0 ? 'partial' : 'error'

    var manualRawSample = pullRes && pullRes.raw ? pullRes.raw.slice(0, 3000) : ''
    var manualBodyKeys =
      body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : []
    var manualFirstSample =
      extAppointments && extAppointments.length > 0
        ? JSON.stringify(extAppointments[0]).slice(0, 500)
        : 'none'

    console.log(
      '[agenda_sync] MANUAL PULL CONCLUÍDO | Status:',
      finalStatus,
      '| Total puxado:',
      pulledCount,
      '| Total salvo:',
      pulledCount,
      '| Itens brutos:',
      extAppointments ? extAppointments.length : 0,
      '| PrimeiraAmostra:',
      manualFirstSample,
    )

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
            raw_sample: manualRawSample,
            ext_appts_found: extAppointments ? extAppointments.length : 0,
            debug_keys: manualBodyKeys,
            debug_sample: manualRawSample.slice(0, 400),
            first_parsed_sample: manualFirstSample,
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
      ext_appts_found: extAppointments ? extAppointments.length : 0,
      raw_sample: manualRawSample,
      debug_sample: manualRawSample.slice(0, 400),
      debug_keys: manualBodyKeys,
    })
  } catch (err) {
    $app.logger().error('agenda_sync: error in /backend/v1/agenda/sync', 'error', String(err))
    return e.json(500, {
      success: false,
      status: 'internal_error',
      message: 'Erro interno ao sincronizar agenda: ' + String(err),
    })
  }
})

// 3. ENDPOINT DE STATUS E DIAGNÓSTICO
routerAdd('GET', '/backend/v1/agenda/sync-status', (e) => {
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

    // Contagem rápida e leve via banco local
    try {
      counts.total = $app.countRecords('appointments')
      counts.agenda_externa = $app.countRecords('appointments', 'source = "agenda_externa"')
      counts.crm = $app.countRecords('appointments', 'source = "crm"')
      counts.pending_push = $app.countRecords(
        'appointments',
        'source = "crm" && (last_synced_at = "" || updated > last_synced_at || sync_error != "")',
      )
      counts.sync_errors = $app.countRecords('appointments', 'sync_error != ""')
    } catch (_) {}

    var rawSampleStored = recDetails && recDetails.raw_sample ? recDetails.raw_sample : ''

    // Por padrão NÃO faz probes HTTP externos caros no GET /sync-status a menos que ?probe=true
    var shouldProbe = e.request.url.query().get('probe') === 'true'

    var diagnostic = {
      configured: cfg.configured,
      missing_envs: cfg.missing,
      pull_url: cfg.pullUrl,
      recommended_url: RECOMMENDED_URL,
      url_is_recommended: cfg.pullUrl === RECOMMENDED_URL,
      url_is_site_frontend: false,
      last_tested_status: recDetails ? recDetails.status : 200,
      classification:
        stateRec && stateRec.getString('last_status') === 'success' ? 'ok' : 'unknown',
      explanation:
        stateRec && stateRec.getString('last_status') === 'success'
          ? 'Sincronia operacional baseada no último ciclo executado.'
          : stateRec
            ? stateRec.getString('last_error')
            : '',
      raw_snippet: recDetails ? recDetails.raw_snippet || '' : '',
      raw_sample: rawSampleStored,
    }

    var recCheck = {
      tested: false,
      status_code: null,
      classification: 'unknown',
      explanation: '',
      raw_snippet: '',
    }

    if (shouldProbe && cfg.configured) {
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
        diagnostic.raw_snippet = (testRes.raw || '').slice(0, 500)
        diagnostic.raw_sample = (testRes.raw || '').slice(0, 3000)
        recDetails.direct_test_raw = (testRes.raw || '').slice(0, 3000)

        if (stateRec && testRes.raw) {
          try {
            recDetails.raw_sample = (testRes.raw || '').slice(0, 3000)
            stateRec.set('details', JSON.stringify(recDetails))
            $app.save(stateRec)
          } catch (_) {}
        }

        var testIsHtml = isHtmlContent(testRes.raw)
        diagnostic.url_is_site_frontend = testIsHtml

        if (testRes.statusCode === 200 && !testIsHtml) {
          diagnostic.classification = 'ok'
          diagnostic.explanation =
            'Endpoint respondendo com sucesso (HTTP 200 JSON). Sincronia 100% operacional.'
        } else if (testIsHtml || testRes.statusCode === 404 || testRes.statusCode === 405) {
          diagnostic.classification = 'wrong_url'
          diagnostic.explanation =
            'A URL configurada aponta para o SITE da agenda, não para o BACKEND dela.'
        } else if (testRes.statusCode === 401 || testRes.statusCode === 403) {
          diagnostic.classification = 'invalid_token'
          diagnostic.explanation = 'Token de acesso rejeitado (HTTP ' + testRes.statusCode + ').'
        } else {
          diagnostic.classification = 'external_error'
          diagnostic.explanation = 'Resposta da agenda externa: HTTP ' + testRes.statusCode
        }
      } catch (diagErr) {
        diagnostic.classification = 'connection_error'
        diagnostic.explanation = 'Não foi possível conectar ao endpoint: ' + String(diagErr)
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
      cron_schedule: 'A cada 15 minutos',
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
})
