// CRON DE FOLLOW-UP PÓS-CONSULTA
// Executa 1x ao dia às 12:43 UTC (09:43 Brasília)
// Restaurado da emergência com kill-switch, blindagem noturna e timeouts curtos
cronAdd('post_consultation_followup', '43 12 * * *', () => {
  try {
    // Kill switch global na PRIMEIRA instrução
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        return
      }
    } catch (_) {}

    // Blindagem noturna: 21h-07h de Brasília (UTC 00h-10h)
    var nMs = Date.now()
    var spD = new Date(nMs - 3 * 3600 * 1000)
    var hSp = spD.getUTCHours()
    if (hSp >= 21 || hSp < 7) {
      return
    }
    var nowTs = Math.floor(Date.now() / 1000)
    var nowIso = new Date().toISOString()
    var threeMonthsAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    var nextDayIso = new Date(Date.now() + 86400000).toISOString()
    var cutoff36hIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString()

    // Helper para verificar se paciente já tem atendimento recente (últimos 3 meses) ou agendamento futuro ativo
    function checkPatientAgendaStatus(contactRec) {
      if (!contactRec) return { hasActiveFuture: false, hasRecentRealizado: false }
      var cId = contactRec.id
      var cPhone = (contactRec.getString('phone') || '').replace(/\D/g, '')
      var cJid = (contactRec.getString('jid') || '').replace(/\D/g, '')
      var suf1 = cPhone.length >= 8 ? cPhone.slice(-8) : ''
      var suf2 = cJid.length >= 8 ? cJid.slice(-8) : ''

      var filterParts = ["patient_id = '" + cId + "'"]
      if (suf1) filterParts.push("patient_phone ~ '" + suf1 + "'")
      if (suf2 && suf2 !== suf1) filterParts.push("patient_phone ~ '" + suf2 + "'")

      var appts = []
      try {
        appts = $app.findRecordsByFilter(
          'appointments',
          '(' + filterParts.join(' || ') + ')',
          '-starts_at',
          50,
          0,
        )
      } catch (_) {}

      var hasActiveFuture = false
      var hasRecentRealizado = false

      for (var ai = 0; ai < appts.length; ai++) {
        var ap = appts[ai]
        var st = ap.getString('status')
        var sAt = ap.getString('starts_at')
        if (!sAt) continue

        if (sAt > nowIso && (st === 'agendado' || st === 'confirmado')) {
          hasActiveFuture = true
        }
        if (sAt <= nowIso && sAt >= threeMonthsAgoIso && st === 'realizado') {
          hasRecentRealizado = true
        }
      }

      return { hasActiveFuture: hasActiveFuture, hasRecentRealizado: hasRecentRealizado }
    }

    var rulesById = {}
    try {
      var allRules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 500, 0)
      for (var r = 0; r < allRules.length; r++) {
        rulesById[allRules[r].id] = allRules[r].getInt('followup_days') || 7
      }
    } catch (_) {}

    var DEFAULT_FOLLOWUP_DAYS = 7
    function getFollowupDays(patient) {
      var ruleId = patient.getString('followup_rule_id')
      if (ruleId && rulesById[ruleId]) return rulesById[ruleId]
      return DEFAULT_FOLLOWUP_DAYS
    }

    var patients = []
    try {
      patients = $app.findRecordsByFilter('crm_contacts', 'is_patient = true', '-updated', 200, 0)
    } catch (err) {
      $app.logger().error('cron_followup: query patients failed', 'error', String(err))
      return
    }

    if (!patients || patients.length === 0) return

    var updatedCount = 0
    var followupCandidates = []

    for (var p = 0; p < patients.length; p++) {
      try {
        var patient = patients[p]
        var careStatus = 'em_dia'
        var convertedAt = patient.getString('converted_at')
        var followupDays = getFollowupDays(patient)

        // Consulta a agenda antes de marcar como precisa_retorno
        var agendaInfo = checkPatientAgendaStatus(patient)
        var hasAgendaCoverage = agendaInfo.hasActiveFuture || agendaInfo.hasRecentRealizado

        if (convertedAt) {
          var convertedTs = Math.floor(new Date(convertedAt).getTime() / 1000)
          var daysSinceConsultation = Math.floor((nowTs - convertedTs) / 86400)
          if (daysSinceConsultation >= followupDays && !hasAgendaCoverage) {
            careStatus = 'precisa_retorno'
          }
          if (daysSinceConsultation === followupDays && !hasAgendaCoverage) {
            followupCandidates.push(patient)
          }
        }

        var lastSynced = patient.getString('last_synced_at')
        if (lastSynced) {
          var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
          var daysSinceContact = Math.floor((nowTs - lastTs) / 86400)
          if (daysSinceContact > 30) {
            careStatus = 'sem_contato_' + daysSinceContact + '_dias'
          }
        }

        if (patient.getString('care_status') !== careStatus) {
          patient.set('care_status', careStatus)
          $app.saveNoValidate(patient)
          updatedCount++
        }
      } catch (_) {}
    }

    var tasksCreated = 0

    for (var i = 0; i < followupCandidates.length; i++) {
      var contact = followupCandidates[i]
      var contactId = contact.id
      var userId = contact.getString('user_id')
      var accountId = contact.getString('account_id')
      var contactName =
        contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
      var instanceName = contact.getString('instance_name') || ''
      var patientFollowupDays = getFollowupDays(contact)

      // Item 2: Instância inexistente = desconectada, pular
      if (!instanceName) continue
      try {
        var instRec = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name}',
          {
            name: instanceName,
          },
        )
        if (!instRec || instRec.getString('status') !== 'connected') {
          continue
        }
      } catch (_) {
        // Instância inexistente ou erro = desconectada, pular
        continue
      }

      var existingTask = null
      try {
        existingTask = $app.findFirstRecordByFilter(
          'tasks',
          'crm_contact_id = {:cid} && title ~ "Follow-up"',
          { cid: contactId },
        )
      } catch (_) {}

      if (existingTask) continue

      var toneExamples = ''
      try {
        var secretaryMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'from_me = true && instance_name = {:inst}',
          '-timestamp',
          15,
          0,
          { inst: contact.getString('instance_name') },
        )
        for (var j = 0; j < secretaryMsgs.length; j++) {
          var content = secretaryMsgs[j].getString('content')
          if (content && content.length > 5) {
            toneExamples += content + '\n'
          }
        }
      } catch (_) {}

      var agentMessage =
        'Gere uma mensagem de follow-up para o paciente ' +
        contactName +
        ' que teve consulta há ' +
        patientFollowupDays +
        ' dias. ' +
        'A mensagem deve ser acolhedora, natural e curta (max 200 chars).'

      if (toneExamples) {
        agentMessage +=
          '\n\n[EXEMPLOS DO TOM DA SECRETÁRIA — replique este estilo]\n' +
          toneExamples +
          '\n\nGere a mensagem de follow-up neste mesmo tom.'
      }

      var followupText = ''
      try {
        var result = $ai.agent('crm-care-agent').chat({
          user_id: userId,
          conversation_id: null,
          message: agentMessage,
        })
        followupText = result.content || ''
      } catch (agentErr) {
        $app
          .logger()
          .error(
            'cron_followup: agent chat failed',
            'contact',
            contactId,
            'error',
            String(agentErr),
          )
        followupText = 'Olá! Como você está se sentindo após a consulta? Estamos à disposição! 🙏'
      }

      if (!followupText)
        followupText = 'Olá! Como você está se sentindo após a consulta? Estamos à disposição! 🙏'

      try {
        // Idempotência: não criar se já existir tarefa de follow-up pendente/em_andamento
        var alreadyHasTask = false
        try {
          var existingFollowups = $app.findRecordsByFilter(
            'tasks',
            "crm_contact_id = {:cid} && (care_category = 'followup_10_15' || title ~ 'Follow-up') && (status = 'pendente' || status = 'em_andamento')",
            '-created',
            1,
            0,
            { cid: contactId },
          )
          if (existingFollowups && existingFollowups.length > 0) {
            alreadyHasTask = true
          }
        } catch (_) {}

        if (alreadyHasTask) continue

        var assignedTo = contact.getString('assigned_to') || ''
        var taskCol = $app.findCollectionByNameOrId('tasks')
        var task = new Record(taskCol)
        task.set('user_id', userId)
        if (accountId) task.set('account_id', accountId)
        task.set('title', 'Follow-up: ' + contactName)
        task.set('description', followupText)
        task.set('status', 'pendente')
        task.set('priority', 'media')
        // Item 1: MEMÓRIA DE CONCLUSÃO — verificar se existe tarefa da categoria followup_10_15
        // concluída nas últimas 36h
        var hasRecentCompleted = false
        try {
          var recentDone = $app.findRecordsByFilter(
            'tasks',
            "crm_contact_id = {:cid} && care_category = 'followup_10_15' && status = 'concluida' && (completed_at >= {:cutoff} || updated >= {:cutoff})",
            '-updated',
            1,
            0,
            { cid: contactId, cutoff: cutoff36hIso },
          )
          if (recentDone && recentDone.length > 0) {
            hasRecentCompleted = true
          }
        } catch (_) {}

        if (hasRecentCompleted) continue

        task.set('care_category', 'followup_10_15')
        task.set('crm_contact_id', contactId)
        task.set('due_date', nextDayIso)
        if (assignedTo) task.set('assigned_to', assignedTo)
        $app.save(task)
        tasksCreated++

        contact.set('ai_suggested_action', 'Follow-up: ' + followupText.substring(0, 120))
        contact.set('care_status', 'precisa_retorno')
        $app.saveNoValidate(contact)

        try {
          var aId = contact.getString('account_id')
          if (aId) {
            var aIsSilenced = false
            try {
              var aSilencePeriods = $app.findRecordsByFilter(
                'care_silence_periods',
                'account_id = {:aid} && enabled = true',
                '-created',
                50,
                0,
                { aid: aId },
              )
              if (aSilencePeriods && aSilencePeriods.length > 0) {
                var aSilNow = new Date()
                var aSilHHMM =
                  ('0' + aSilNow.getHours()).slice(-2) +
                  ':' +
                  ('0' + aSilNow.getMinutes()).slice(-2)
                var aSilDay = aSilNow.getDay()
                for (var asp = 0; asp < aSilencePeriods.length; asp++) {
                  var aSpStart = aSilencePeriods[asp].getString('start_time')
                  var aSpEnd = aSilencePeriods[asp].getString('end_time')
                  if (!aSpStart || !aSpEnd) continue
                  var aSpWdRaw = aSilencePeriods[asp].get('weekdays')
                  var aSpWd = []
                  if (aSpWdRaw) {
                    try {
                      var aSpParsed = typeof aSpWdRaw === 'string' ? JSON.parse(aSpWdRaw) : aSpWdRaw
                      if (Array.isArray(aSpParsed)) aSpWd = aSpParsed
                    } catch (_) {}
                  }
                  if (aSpWd.length > 0 && aSpWd.indexOf(aSilDay) === -1) continue
                  if (aSpStart <= aSpEnd) {
                    if (aSilHHMM >= aSpStart && aSilHHMM < aSpEnd) {
                      aIsSilenced = true
                      break
                    }
                  } else {
                    if (aSilHHMM >= aSpStart || aSilHHMM < aSpEnd) {
                      aIsSilenced = true
                      break
                    }
                  }
                }
              }
            } catch (_) {}
            if (aIsSilenced) continue
            var aSettings = null
            try {
              aSettings = $app.findFirstRecordByFilter(
                'care_alert_settings',
                'account_id = {:aid}',
                {
                  aid: aId,
                },
              )
            } catch (_) {}

            // KILL SWITCH GLOBAL: se automações pausadas, não envia WhatsApp do alerta
            if (aSettings && aSettings.getBool('global_automations_paused')) {
              $app
                .logger()
                .info(
                  'Envio cancelado: automações globais pausadas',
                  'cron',
                  'post_consultation_followup',
                  'account_id',
                  aId,
                )
              continue
            }

            if (
              aSettings &&
              aSettings.getBool('followup_alert_enabled') &&
              aSettings.getString('whatsapp_alert_phone')
            ) {
              var aPhone = aSettings.getString('whatsapp_alert_phone').replace(/\D/g, '')
              var aCutoff = new Date(Date.now() - 86400000).toISOString()
              var aDup = false
              try {
                $app.findFirstRecordByFilter(
                  'care_alerts',
                  'crm_contact_id = {:cid} && type = {:t} && created >= {:c}',
                  { cid: contactId, t: 'followup', c: aCutoff },
                )
                aDup = true
              } catch (_) {}
              if (!aDup && aPhone) {
                var aMsg =
                  'Dr. Caio, a paciente ' +
                  contactName +
                  ' completou ' +
                  patientFollowupDays +
                  ' dias desde a consulta e esta precisando de retorno. 💛\n\nSugestao: ' +
                  followupText.substring(0, 200)
                var aInst = contact.getString('instance_name')
                var aUrl = $secrets.get('EVOLUTION_API_URL')
                var aKey = $secrets.get('EVOLUTION_API_KEY')
                var aCol = $app.findCollectionByNameOrId('care_alerts')
                var aRec = new Record(aCol)
                aRec.set('account_id', aId)
                aRec.set('type', 'followup')
                aRec.set('crm_contact_id', contactId)
                aRec.set('message', aMsg)
                aRec.set('status', 'pending')
                $app.save(aRec)
                var aStatus = 'failed'
                if (aUrl && aKey && aInst) {
                  var aU = aUrl.endsWith('/') ? aUrl.slice(0, -1) : aUrl
                  try {
                    var aRes = $http.send({
                      url: aU + '/message/sendText/' + aInst,
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', apikey: aKey },
                      body: JSON.stringify({ number: aPhone, text: aMsg }),
                      timeout: 5,
                    })
                    aStatus = aRes.statusCode === 200 || aRes.statusCode === 201 ? 'sent' : 'failed'
                  } catch (_) {}
                }
                aRec.set('status', aStatus)
                aRec.set('sent_at', new Date().toISOString())
                $app.save(aRec)
              }
            }
          }
        } catch (_) {}
      } catch (taskErr) {
        $app
          .logger()
          .error(
            'cron_followup: create task failed',
            'contact',
            contactId,
            'error',
            String(taskErr),
          )
      }
    }

    if (updatedCount > 0 || tasksCreated > 0) {
      $app
        .logger()
        .info(
          'cron_followup_done',
          'care_status_updated',
          updatedCount,
          'tasks_created',
          tasksCreated,
        )
    }
  } catch (fatalErr) {
    $app.logger().error('cron_followup_fatal', 'error', String(fatalErr))
  }
})
