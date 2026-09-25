/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON DIÁRIO DE RECONCILIAÇÃO POR IA DA AGENDA
 * Execução: 1x ao dia às 04:19 UTC (minuto :19, desempilhado de outros crons)
 *
 * Requisitos:
 * 1. Kill-switch na PRIMEIRA linha: se care_alert_settings global_automations_paused=true, return
 * 2. Leitura da oficial com fetchWithRetry inline (3 tentativas, recuo 1s/2s/4s, timeout 4-5s, X-CRM-Token)
 * 3. Comparação com espelhos locais source='agenda_externa':
 *    - Soft-cancel de agendamentos sumidos na oficial (janela -60d a +60d): status='cancelado', notes='Cancelado/removido na agenda oficial'
 *    - NUNCA apagar fisicamente, NUNCA aplicar a source='crm'
 *    - Alinhar status divergentes com alta confiança
 * 4. Casos ambíguos geram registros na coleção 'tasks' (status 'pendente', prioridade 'alta') para revisão humana
 * 5. Vincular os órfãos sem patient_id por matching de telefone-sufixo / nome:
 *    - Alta confiança vincula em crm_contacts (e conversation_id)
 *    - Ambíguo vira task para secretária
 * 6. Night Shield: entre 21h e 07h NUNCA enviar mensagem WhatsApp (apenas alinhar dados e gerar tasks)
 * 7. Logs em português com prefixo [cron_reconciliacao_ia], sem loops de espera excessivos
 *
 * NOTA JSVM: Todas as funções declaradas INLINE dentro do callback de cronAdd.
 */

cronAdd('agenda_reconciliation', '19 4 * * *', () => {
  try {
    // 1. KILL-SWITCH GLOBAL COMO PRIMEIRA INSTRUÇÃO
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        $app
          .logger()
          .info(
            '[cron_reconciliacao_ia] Interrompido por kill-switch global ativo (global_automations_paused=true)',
          )
        return
      }
    } catch (_) {}

    $app.logger().info('[cron_reconciliacao_ia] Iniciando ciclo de reconciliação de agenda')

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
            // Pausa breve
          }
        }
      }

      return { success: false, res: lastRes, error: lastErr }
    }

    // Resolver Account ID
    var accountId = 'u2cbx6yw2gm0ook'
    try {
      var caioUser = $app.findAuthRecordByEmail('_pb_users_auth_', 'caiocandidonutri@hotmail.com')
      if (caioUser) {
        var mRec = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: caioUser.id,
        })
        if (mRec) accountId = mRec.getString('account_id')
      }
    } catch (_) {}

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

    var headers = {
      Accept: 'application/json',
      'X-CRM-Token': rawToken,
      Authorization: 'Bearer ' + rawToken,
    }

    // 2. Leitura externa com fetchWithRetry
    var fetchResult = fetchWithRetry(pullUrl, {
      method: 'GET',
      headers: headers,
      timeout: 5,
    })

    if (!fetchResult.success || !fetchResult.res || fetchResult.res.statusCode !== 200) {
      $app
        .logger()
        .warn(
          '[cron_reconciliacao_ia] Falha ao consultar agenda oficial na reconciliação',
          'erro',
          fetchResult.error
            ? String(fetchResult.error)
            : 'HTTP ' + (fetchResult.res ? fetchResult.res.statusCode : 0),
        )
      return
    }

    var pullBody = fetchResult.res.json
    if (!pullBody && fetchResult.res.raw) {
      try {
        pullBody = JSON.parse(fetchResult.res.raw)
      } catch (_) {}
    }

    var externalItems = []
    if (Array.isArray(pullBody)) {
      externalItems = pullBody
    } else if (pullBody && pullBody.agendamentos && Array.isArray(pullBody.agendamentos)) {
      externalItems = pullBody.agendamentos
    } else if (pullBody && pullBody.appointments && Array.isArray(pullBody.appointments)) {
      externalItems = pullBody.appointments
    } else if (pullBody && pullBody.dados && Array.isArray(pullBody.dados)) {
      externalItems = pullBody.dados
    }

    var extMap = {}
    for (var k = 0; k < externalItems.length; k++) {
      var item = externalItems[k]
      var extId = String(item.id || item.external_id || '').trim()
      if (extId) {
        extMap[extId] = item
      }
    }

    // 3. Soft-cancel e alinhamento de status na janela de 120 dias (-60 a +60 dias)
    var nowUtcMs = Date.now()
    var windowStartIso = new Date(nowUtcMs - 60 * 24 * 3600 * 1000).toISOString()
    var windowEndIso = new Date(nowUtcMs + 60 * 24 * 3600 * 1000).toISOString()

    var localExtAppts = []
    try {
      localExtAppts = $app.findRecordsByFilter(
        'appointments',
        'source = "agenda_externa" && external_id != "" && starts_at >= {:wStart} && starts_at <= {:wEnd}',
        'starts_at',
        500,
        0,
        { wStart: windowStartIso, wEnd: windowEndIso },
      )
    } catch (_) {}

    var softCancelledCount = 0
    var alignedCount = 0
    var ambiguousTasksCount = 0

    var tasksCol = null
    try {
      tasksCol = $app.findCollectionByNameOrId('tasks')
    } catch (_) {}

    function createTask(title, description, crmContactId) {
      if (!tasksCol) return
      try {
        try {
          var exTask = $app.findFirstRecordByFilter(
            'tasks',
            'title = {:t} && status = "pendente"',
            {
              t: title,
            },
          )
          if (exTask) return
        } catch (_) {}

        var tRec = new Record(tasksCol)
        tRec.set('account_id', accountId)
        tRec.set('title', title)
        tRec.set('description', description)
        tRec.set('status', 'pendente')
        tRec.set('priority', 'alta')
        tRec.set('care_category', 'precisa_retorno')
        if (crmContactId) {
          tRec.set('crm_contact_id', crmContactId)
        }
        $app.save(tRec)
        ambiguousTasksCount++
      } catch (errTask) {
        $app.logger().warn('[cron_reconciliacao_ia] Falha ao criar task', 'erro', String(errTask))
      }
    }

    for (var l = 0; l < localExtAppts.length; l++) {
      var local = localExtAppts[l]
      var extIdLocal = local.getString('external_id')
      var localStatus = local.getString('status')
      var pName = local.getString('patient_name') || 'Paciente'
      var pContactId = local.getString('patient_id')

      var remote = extMap[extIdLocal]

      // Cenário A: Item não consta mais na resposta oficial
      if (!remote) {
        if (localStatus !== 'cancelado') {
          local.set('status', 'cancelado')
          var notes = local.getString('notes')
          var cancelNote = 'Cancelado/removido na agenda oficial'
          local.set('notes', notes ? notes + ' (' + cancelNote + ')' : cancelNote)
          local.set('last_synced_at', new Date().toISOString())
          try {
            $app.saveNoValidate(local)
            softCancelledCount++
            $app
              .logger()
              .info(
                '[cron_reconciliacao_ia] Soft-cancel aplicado: agendamento ausente na agenda oficial',
                'id',
                local.id,
                'paciente',
                pName,
              )
          } catch (_) {}
        }
        continue
      }

      // Cenário B: Item consta na oficial, comparar status
      var remoteStatus = remote.status || 'agendado'

      if (remoteStatus === 'cancelado' && localStatus !== 'cancelado') {
        local.set('status', 'cancelado')
        var notesR = local.getString('notes')
        var cancelNoteR = 'Cancelado na agenda oficial'
        local.set('notes', notesR ? notesR + ' (' + cancelNoteR + ')' : cancelNoteR)
        local.set('last_synced_at', new Date().toISOString())
        try {
          $app.saveNoValidate(local)
          softCancelledCount++
          $app
            .logger()
            .info(
              '[cron_reconciliacao_ia] Soft-cancel aplicado: status cancelado na oficial',
              'id',
              local.id,
              'paciente',
              pName,
            )
        } catch (_) {}
      } else if (
        localStatus === 'confirmado' &&
        (remoteStatus === 'agendado' || remoteStatus === 'aguardando')
      ) {
        try {
          $http.send({
            url: baseUrl + '/backend/v1/crm-agendamento/' + extIdLocal,
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-CRM-Token': rawToken,
            },
            body: JSON.stringify({ status: 'confirmado' }),
            timeout: 5,
          })
          alignedCount++
        } catch (_) {}
      } else if (
        localStatus !== remoteStatus &&
        localStatus !== 'confirmado' &&
        localStatus !== 'cancelado'
      ) {
        createTask(
          'Divergência na agenda: ' + pName,
          'O agendamento de ' +
            pName +
            ' em ' +
            local.getString('starts_at') +
            ' consta como "' +
            remoteStatus +
            '" na agenda oficial mas está "' +
            localStatus +
            '" no CRM. Favor verificar.',
          pContactId,
        )
      }
    }

    // 4. Vincular órfãos sem patient_id por matching de nome e telefone-sufixo
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

    var orphanAppts = []
    try {
      orphanAppts = $app.findRecordsByFilter(
        'appointments',
        'patient_id = "" || patient_id = null',
        '-starts_at',
        50,
        0,
      )
    } catch (_) {}

    var resolvedOrphansCount = 0

    for (var m = 0; m < orphanAppts.length; m++) {
      var orph = orphanAppts[m]
      var orphPhoneDigits = cleanDigits(orph.getString('patient_phone'))
      var orphName = orph.getString('patient_name')
      var orphNormName = normalizeName(orphName)

      var matchedContact = null
      var matchType = 'none'

      // Tentativa 1: Matching de telefone por sufixo de 8 dígitos
      if (orphPhoneDigits.length >= 8) {
        var suf = orphPhoneDigits.slice(-8)
        try {
          var candidateContacts = $app.findRecordsByFilter(
            'crm_contacts',
            'phone ~ {:suf} || jid ~ {:suf}',
            '-updated',
            5,
            0,
            { suf: suf },
          )
          if (candidateContacts && candidateContacts.length === 1) {
            matchedContact = candidateContacts[0]
            matchType = 'phone_high_confidence'
          } else if (candidateContacts && candidateContacts.length > 1) {
            matchType = 'ambiguous_multiple_phone'
          }
        } catch (_) {}
      }

      // Tentativa 2: Matching por nome normalizado de alta confiança
      if (!matchedContact && matchType !== 'ambiguous_multiple_phone' && orphNormName.length >= 5) {
        try {
          var nameCandidates = $app.findRecordsByFilter(
            'crm_contacts',
            'name ~ {:part}',
            '-updated',
            10,
            0,
            { part: orphName.split(' ')[0] },
          )

          var exactMatches = []
          for (var nc = 0; nc < nameCandidates.length; nc++) {
            var cNorm = normalizeName(nameCandidates[nc].getString('name'))
            if (
              cNorm &&
              (cNorm === orphNormName ||
                cNorm.indexOf(orphNormName) !== -1 ||
                orphNormName.indexOf(cNorm) !== -1)
            ) {
              exactMatches.push(nameCandidates[nc])
            }
          }

          if (exactMatches.length === 1) {
            matchedContact = exactMatches[0]
            matchType = 'name_high_confidence'
          } else if (exactMatches.length > 1) {
            matchType = 'ambiguous_multiple_names'
          }
        } catch (_) {}
      }

      if (matchedContact) {
        orph.set('patient_id', matchedContact.id)
        if (!orph.getString('patient_phone') && matchedContact.getString('phone')) {
          orph.set('patient_phone', matchedContact.getString('phone'))
        }

        if (!orph.getString('conversation_id')) {
          try {
            var conv = $app.findFirstRecordByFilter(
              'conversations',
              'contact_id = {:cid} || remote_jid = {:jid}',
              { cid: matchedContact.id, jid: matchedContact.getString('jid') },
            )
            if (conv) {
              orph.set('conversation_id', conv.id)
            }
          } catch (_) {}
        }

        try {
          $app.saveNoValidate(orph)
          resolvedOrphansCount++
          $app
            .logger()
            .info(
              '[cron_reconciliacao_ia] Agendamento órfão vinculado com sucesso (' + matchType + ')',
              'apptId',
              orph.id,
              'patientId',
              matchedContact.id,
              'paciente',
              orphName,
            )
        } catch (_) {}
      } else if (
        matchType.indexOf('ambiguous') !== -1 ||
        (!orph.getString('patient_phone') && orphNormName.length >= 4)
      ) {
        createTask(
          'Vincular paciente da agenda: ' + (orphName || 'Agendamento sem contato'),
          'O agendamento ' +
            orph.id +
            ' em ' +
            orph.getString('starts_at') +
            ' para "' +
            orphName +
            '" (telefone: ' +
            (orph.getString('patient_phone') || 'não informado') +
            ') não pôde ser vinculado automaticamente com certeza. Favor vincular ao contato correto no CRM.',
          null,
        )
      }
    }

    $app
      .logger()
      .info(
        '[cron_reconciliacao_ia] Ciclo finalizado com sucesso',
        'soft_cancelled',
        softCancelledCount,
        'aligned',
        alignedCount,
        'resolved_orphans',
        resolvedOrphansCount,
        'ambiguous_tasks',
        ambiguousTasksCount,
      )
  } catch (fatalErr) {
    $app
      .logger()
      .error('[cron_reconciliacao_ia] Erro fatal durante a reconciliação', 'erro', String(fatalErr))
  }
})
