/// <reference path="../pb_data/types.d.ts" />

/**
 * CRON DIÁRIO DE RECONCILIAÇÃO POR IA DA AGENDA
 * Execução: 1x ao dia às 04:19 UTC (minuto :19, desempilhado de outros crons)
 *
 * Requisitos:
 * 1. Kill-switch (global_automations_paused em care_alert_settings) como primeira instrução
 * 2. Night Shield 21h-07h de Brasília (UTC 00h-10h): às 04:19 UTC são 01:19 BRT (dentro da blindagem),
 *    mas como é processo de auditoria de dados interno (não envia WhatsApp para paciente), o Night Shield
 *    aqui garante que chamadas externas usem timeout restrito de 4s e NÃO disparem notificações/mensagens a pacientes.
 * 3. Timeout máximo de 4s por requisição externa.
 * 4. Ações:
 *    a) Reprocessar pushes com sync_error pendente para a agenda oficial
 *    b) Espelhar status CRM -> agenda oficial (confirmado / cancelado)
 *    c) Comparar as duas agendas do dia e próximos dias
 *    d) Gerar tarefas na coleção 'tasks' para decisão humana quando houver divergências
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
        $app.logger().info('cron_agenda_reconciliation: skip por kill-switch global ativo')
        return
      }
    } catch (_) {}

    function isNightShieldActive() {
      var nMs = Date.now()
      var spD = new Date(nMs - 3 * 3600 * 1000)
      var hSp = spD.getUTCHours()
      return hSp >= 21 || hSp < 7
    }

    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken =
      ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
      'crm_agenda_token_dr_caio_2026'

    var baseUrl = RECOMMENDED_BASE_URL
    if (rawUrl) {
      var normalized = rawUrl
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized
      }
      var qIdx = normalized.indexOf('?')
      var pathAndOrigin = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
      if (pathAndOrigin.endsWith('/')) {
        pathAndOrigin = pathAndOrigin.slice(0, -1)
      }
      if (pathAndOrigin.indexOf('/backend/v1/crm-dados') !== -1) {
        baseUrl = pathAndOrigin.slice(0, pathAndOrigin.indexOf('/backend/v1/crm-dados'))
      } else {
        baseUrl = pathAndOrigin
      }
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }
    }

    function formatBRDate(d) {
      var spOffsetMs = -3 * 3600 * 1000
      var spDate = new Date(d.getTime() + spOffsetMs)
      var day = String(spDate.getUTCDate())
      if (day.length < 2) day = '0' + day
      var month = String(spDate.getUTCMonth() + 1)
      if (month.length < 2) month = '0' + month
      var year = spDate.getUTCFullYear()
      return day + '/' + month + '/' + year
    }

    // Ação A: Reprocessar pushes com sync_error pendente
    var errorAppts = []
    try {
      errorAppts = $app.findRecordsByFilter(
        'appointments',
        'source = "crm" && sync_error != ""',
        '-created',
        20,
        0,
      )
    } catch (_) {}

    for (var i = 0; i < errorAppts.length; i++) {
      var record = errorAppts[i]
      try {
        var extIdForPush = record.getString('external_id')
        var startsAtIso = record.getString('starts_at')
        var startsAtDate = startsAtIso ? new Date(startsAtIso) : new Date()
        var dateBR = formatBRDate(startsAtDate)

        var payload = {
          patient_name: record.getString('patient_name'),
          patient_phone: record.getString('patient_phone'),
          doctor: record.getString('doctor') || 'Dr. Caio',
          city: record.getString('city'),
          location: record.getString('location'),
          starts_at: startsAtIso,
          ends_at: record.getString('ends_at'),
          status: record.getString('status') || 'confirmado',
          appointment_type: record.getString('appointment_type') || 'Consulta',
          notes: record.getString('notes'),
          source: 'crm',
          data_inicio: dateBR,
          data_agendamento: dateBR,
        }

        var pushHeaders = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
          Authorization: 'Bearer ' + rawToken,
        }

        var pushUrl = baseUrl + '/api/collections/appointments/records'
        var pushMethod = 'POST'
        if (extIdForPush) {
          pushUrl += '/' + extIdForPush
          pushMethod = 'PATCH'
        }

        var pushRes = $http.send({
          url: pushUrl,
          method: pushMethod,
          headers: pushHeaders,
          body: JSON.stringify(payload),
          timeout: 4,
        })

        if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
          if (pushRes.json && pushRes.json.id) {
            record.set('external_id', pushRes.json.id)
          }
          record.set('last_synced_at', new Date().toISOString())
          record.set('sync_error', '')
          $app.saveNoValidate(record)
          $app
            .logger()
            .info('cron_agenda_reconciliation: push repassado com sucesso', 'id', record.id)
        } else {
          var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 150)
          record.set('sync_error', pushErr)
          $app.saveNoValidate(record)
        }
      } catch (errPush) {
        record.set('sync_error', 'Push falhou: ' + String(errPush).slice(0, 150))
        try {
          $app.saveNoValidate(record)
        } catch (_) {}
      }
    }

    // Ação B & C: Comparar as duas agendas dos próximos 7 dias
    var nowUtc = new Date()
    var startIso = new Date(nowUtc.getTime() - 24 * 3600 * 1000).toISOString()
    var endIso = new Date(nowUtc.getTime() + 7 * 24 * 3600 * 1000).toISOString()

    var pullUrl = baseUrl + '/backend/v1/crm-dados?tipo=tudo'
    var pullRes = null
    try {
      pullRes = $http.send({
        url: pullUrl,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
          Authorization: 'Bearer ' + rawToken,
        },
        timeout: 4,
      })
    } catch (ePull) {
      $app.logger().warn('cron_agenda_reconciliation: pull failed', 'error', String(ePull))
      return
    }

    if (!pullRes || pullRes.statusCode !== 200) {
      return
    }

    var pullBody = pullRes.json
    if (!pullBody && pullRes.raw) {
      try {
        pullBody = JSON.parse(pullRes.raw)
      } catch (_) {}
    }

    var externalItems = []
    if (Array.isArray(pullBody)) {
      externalItems = pullBody
    } else if (pullBody && pullBody.agendamentos && Array.isArray(pullBody.agendamentos)) {
      externalItems = pullBody.agendamentos
    } else if (pullBody && pullBody.appointments && Array.isArray(pullBody.appointments)) {
      externalItems = pullBody.appointments
    }

    // Mapear externos por external_id
    var extMap = {}
    for (var k = 0; k < externalItems.length; k++) {
      var item = externalItems[k]
      if (item && item.id) {
        extMap[item.id] = item
      }
    }

    // Buscar consultas locais dos próximos 7 dias
    var localAppts = []
    try {
      localAppts = $app.findRecordsByFilter(
        'appointments',
        'starts_at >= {:sIso} && starts_at <= {:eIso}',
        'starts_at',
        200,
        0,
        { sIso: startIso, eIso: endIso },
      )
    } catch (_) {}

    var accountId = 'u2cbx6yw2gm0ook'

    for (var l = 0; l < localAppts.length; l++) {
      var local = localAppts[l]
      var extId = local.getString('external_id')
      var localStatus = local.getString('status')

      if (extId && extMap[extId]) {
        var remote = extMap[extId]
        var remoteStatus = remote.status || 'agendado'

        // Espelhar status se confirmado/cancelado no CRM mas diferente na oficial
        if (localStatus === 'confirmado' && remoteStatus !== 'confirmado') {
          try {
            $http.send({
              url: baseUrl + '/api/collections/appointments/records/' + extId,
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CRM-Token': rawToken,
                Authorization: 'Bearer ' + rawToken,
              },
              body: JSON.stringify({ status: 'confirmado' }),
              timeout: 4,
            })
          } catch (_) {}
        } else if (localStatus === 'cancelado' && remoteStatus !== 'cancelado') {
          try {
            $http.send({
              url: baseUrl + '/api/collections/appointments/records/' + extId,
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CRM-Token': rawToken,
                Authorization: 'Bearer ' + rawToken,
              },
              body: JSON.stringify({ status: 'cancelado' }),
              timeout: 4,
            })
          } catch (_) {}
        } else if (
          localStatus !== remoteStatus &&
          remoteStatus === 'cancelado' &&
          localStatus !== 'cancelado'
        ) {
          // Divergência crítica: paciente cancelou na oficial mas no CRM ainda consta agendado/confirmado!
          // Gerar tarefa de revisão humana
          var pNameDiv = local.getString('patient_name') || 'Paciente'
          var hasTask = false
          try {
            var exT = $app.findFirstRecordByFilter(
              'tasks',
              'account_id = {:aid} && title ~ {:pname} && status = "pendente"',
              { aid: accountId, pname: pNameDiv },
            )
            if (exT) hasTask = true
          } catch (_) {}

          if (!hasTask) {
            try {
              var tCol = $app.findCollectionByNameOrId('tasks')
              var tRec = new Record(tCol)
              tRec.set('account_id', accountId)
              tRec.set('title', 'Divergência de status na agenda: ' + pNameDiv)
              tRec.set(
                'description',
                'O agendamento de ' +
                  pNameDiv +
                  ' em ' +
                  local.getString('starts_at') +
                  ' consta como "' +
                  remoteStatus +
                  '" na agenda oficial mas está "' +
                  localStatus +
                  '" no CRM. Verificar com o paciente.',
              )
              tRec.set('status', 'pendente')
              tRec.set('priority', 'alta')
              tRec.set('care_category', 'precisa_retorno')
              if (local.getString('patient_id')) {
                tRec.set('crm_contact_id', local.getString('patient_id'))
              }
              $app.save(tRec)
            } catch (_) {}
          }
        }
      }
    }
  } catch (fatalErr) {
    $app.logger().error('cron_agenda_reconciliation_fatal', 'error', String(fatalErr))
  }
})
