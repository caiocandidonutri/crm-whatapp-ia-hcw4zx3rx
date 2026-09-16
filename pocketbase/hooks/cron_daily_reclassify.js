cronAdd('daily_reclassify', '0 9 * * *', () => {
  var accounts = []
  try {
    accounts = $app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
  } catch (_) {
    return
  }
  if (!accounts || accounts.length === 0) return

  var nowTs = Math.floor(Date.now() / 1000)
  var fortyEightHoursAgo = nowTs - 48 * 3600

  var rulesById = {}
  var rulesDescriptionText =
    'Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d)'
  try {
    var allRules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 500, 0)
    var ruleLines = []
    for (var rl = 0; rl < allRules.length; rl++) {
      var rId = allRules[rl].id
      var rName = allRules[rl].getString('name')
      var rDays = allRules[rl].getInt('followup_days') || 10
      rulesById[rId] = rDays
      if (rName) {
        ruleLines.push(rName + ' (' + rDays + 'd)')
      }
    }
    if (ruleLines.length > 0) {
      rulesDescriptionText = ruleLines.join(', ')
    }
  } catch (_) {}
  // --- Limiares de follow-up por conta (care_followup_thresholds) ---
  // Permite configurar após quantos dias sem resposta um paciente entra
  // em cada categoria: "nao_respondeu", "precisa_atencao", "perdido".
  // Defaults: nao_respondeu=3, precisa_atencao=7, perdido=15.
  var DEFAULT_THRESHOLDS = {
    nao_respondeu: 3,
    precisa_atencao: 7,
    perdido: 15,
  }
  var thresholdsByAccount = {}
  try {
    var allThresholds = $app.findRecordsByFilter(
      'care_followup_thresholds',
      'id != ""',
      'created',
      500,
      0,
    )
    for (var th = 0; th < allThresholds.length; th++) {
      var tRec = allThresholds[th]
      var tAccId = tRec.getString('account_id')
      if (!thresholdsByAccount[tAccId]) {
        thresholdsByAccount[tAccId] = {
          nao_respondeu: DEFAULT_THRESHOLDS.nao_respondeu,
          precisa_atencao: DEFAULT_THRESHOLDS.precisa_atencao,
          perdido: DEFAULT_THRESHOLDS.perdido,
        }
      }
      var tCat = tRec.getString('category')
      if (tRec.getBool('enabled') && thresholdsByAccount[tAccId][tCat] !== undefined) {
        thresholdsByAccount[tAccId][tCat] = tRec.getInt('days') || DEFAULT_THRESHOLDS[tCat]
      }
    }
  } catch (_) {}

  var getThresholds = function (accId) {
    if (accId && thresholdsByAccount[accId]) return thresholdsByAccount[accId]
    return DEFAULT_THRESHOLDS
  }

  var totalClassified = 0
  var totalProcessed = 0
  var nowIso = new Date().toISOString()
  var threeMonthsAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

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

  for (var a = 0; a < accounts.length; a++) {
    var accountId = accounts[a].id
    var contacts = []
    try {
      contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'account_id = {:accId}',
        '-updated',
        500,
        0,
        { accId: accountId },
      )
    } catch (_) {
      continue
    }
    if (!contacts || contacts.length === 0) continue

    var aiClassified = 0

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i]
      var jid = contact.getString('jid') || ''
      var instanceName = contact.getString('instance_name') || ''

      // Se o contato pertencer a instância desconectada, pula
      if (!instanceName) continue
      try {
        var instRec = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name}',
          { name: instanceName },
        )
        if (!instRec || instRec.getString('status') !== 'connected') {
          continue
        }
      } catch (_) {
        // Instância inexistente ou erro = desconectada, pular
        continue
      }

      // Regra 1: Não reclassificar clientes fechados via IA
      var isAlreadyCliente = contact.getString('stage') === 'cliente'

      // Regra 2: Cooldown de 6 horas
      var lastReclassStr = contact.getString('last_ai_reclassified_at')
      var inCooldown = false
      if (lastReclassStr) {
        var lastReclassTime = new Date(lastReclassStr).getTime()
        if (!isNaN(lastReclassTime) && Date.now() - lastReclassTime < 6 * 3600 * 1000) {
          inCooldown = true
        }
      }

      if (!isAlreadyCliente && !inCooldown && aiClassified < 20 && jid && instanceName) {
        var messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst} && timestamp >= {:ts}',
            '-timestamp',
            8,
            0,
            { jid: jid, inst: instanceName, ts: fortyEightHoursAgo },
          )
        } catch (_) {}

        if (messages && messages.length > 0) {
          function formatMessageContent(m) {
            var content = m.getString('content')
            if (content && content.trim()) {
              return content.trim().length > 300
                ? content.trim().substring(0, 300) + '…'
                : content.trim()
            }
            var transcription = m.getString('transcription')
            if (transcription && transcription.trim() && transcription !== 'SKIP_NO_TRANSCRIBE') {
              var cut = transcription.trim()
              return (
                '[áudio transcrito: ' + (cut.length > 200 ? cut.substring(0, 200) + '…' : cut) + ']'
              )
            }
            var msgType = m.getString('message_type') || ''
            if (msgType === 'audioMessage' || msgType === 'audio' || msgType === 'ptt') {
              return '[áudio de voz]'
            }
            return '[mídia]'
          }

          var transcript = messages
            .slice()
            .reverse()
            .map(function (m) {
              var from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
              return from + ': ' + formatMessageContent(m)
            })
            .join('\n')

          var contactName =
            contact.getString('contact_name') || contact.getString('push_name') || jid

          var pStage = contact.getString('stage') || 'lead'
          var pCare = contact.getString('care_status') || 'em_dia'
          var cTasksCount = 0
          try {
            var cTasks = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
              '-created',
              5,
              0,
              { cid: contact.id },
            )
            cTasksCount = cTasks ? cTasks.length : 0
          } catch (_) {}

          try {
            var sysPrompt =
              'Você é o assistente de CRM e inteligência clínica da clínica de nutrição do Dr. Caio Cândido.\n' +
              'Papéis fundamentais da clínica:\n' +
              '- "Dr. Caio" / "Dr. Caio Cândido" é o nutricionista responsável pelas condutas e consultas.\n' +
              '- "Fabiana" é a assistente/secretária de acolhimento e agendamento.\n' +
              '- Dr. Caio e Fabiana NUNCA devem ser interpretados como pacientes. O paciente/cliente é o interlocutor externo.\n' +
              'Regras de Follow-up lidas da clínica: ' +
              rulesDescriptionText +
              '.\n' +
              'Vocabulário nutricional/clínico relevante: SOP (Síndrome dos Ovários Policísticos), plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica, sintomas e exames.\n' +
              'Responda APENAS em JSON válido com os campos: ' +
              'stage (um de: lead, em_atendimento, cliente, nao_respondido), ' +
              'role (um de: paciente, nao_paciente), ' +
              'is_patient (boolean: true se o contato é paciente/cliente que fechou consulta com Dr. Caio), ' +
              'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta), ' +
              'suggested_action (breve próxima ação recomendada, max 120 chars), ' +
              'priority (número 1-10, onde 10 é urgente).'

            var userContent =
              'Paciente/Contato: ' +
              contactName +
              '\n' +
              'Estágio do pipeline (stage): ' +
              pStage +
              '\n' +
              'Status de cuidado (care_status): ' +
              pCare +
              '\n' +
              'Tarefas de cuidado ativas: ' +
              cTasksCount +
              '\n\n' +
              'Histórico da Conversa:\n' +
              transcript

            var reply = $ai.chat({
              model: 'fast',
              messages: [
                {
                  role: 'system',
                  content: sysPrompt,
                },
                {
                  role: 'user',
                  content: userContent,
                },
              ],
            })

            var rawText =
              reply.choices &&
              reply.choices[0] &&
              reply.choices[0].message &&
              reply.choices[0].message.content
            if (rawText) {
              var jsonMatch = rawText.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                var aiResult = JSON.parse(jsonMatch[0])
                var validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
                if (aiResult.stage && validStages.indexOf(aiResult.stage) >= 0) {
                  contact.set('stage', aiResult.stage)
                }
                if (aiResult.role === 'paciente' || aiResult.role === 'nao_paciente') {
                  contact.set('role', aiResult.role)
                }

                var conversionDetected = aiResult.conversion_detected === true
                var isPatient = aiResult.is_patient === true

                if (conversionDetected || isPatient) {
                  if (!contact.getBool('is_patient')) contact.set('is_patient', true)
                  if (!contact.getString('converted_at')) {
                    contact.set('converted_at', new Date().toISOString().split('T')[0])
                  }
                  if (conversionDetected) contact.set('stage', 'cliente')
                }

                if (aiResult.suggested_action) {
                  contact.set(
                    'ai_suggested_action',
                    String(aiResult.suggested_action).substring(0, 500),
                  )
                }
                if (aiResult.priority !== undefined) {
                  var pri = Number(aiResult.priority)
                  if (Number.isFinite(pri)) {
                    contact.set('ai_priority', Math.min(Math.max(pri, 1), 10))
                  }
                }
                aiClassified++
                totalClassified++
                var nowIso = new Date().toISOString().replace('T', ' ')
                contact.set('last_ai_reclassified_at', nowIso)

                try {
                  var dNow = new Date()
                  var utcNow = dNow.getTime() + dNow.getTimezoneOffset() * 60000
                  var spTime = new Date(utcNow - 3 * 3600000)
                  var dayKey =
                    spTime.getFullYear() +
                    '-' +
                    String(spTime.getMonth() + 1).padStart(2, '0') +
                    '-' +
                    String(spTime.getDate()).padStart(2, '0')
                  var uFilter = accountId
                    ? "day_key = '" + dayKey + "' && account_id = '" + accountId + "'"
                    : "day_key = '" + dayKey + "'"
                  var uR = null
                  try {
                    uR = $app.findFirstRecordByFilter('app_daily_usage', uFilter)
                  } catch (_) {}
                  if (uR) {
                    uR.set('ai_analyses_count', (uR.getInt('ai_analyses_count') || 0) + 1)
                    $app.save(uR)
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      var careStatus = 'em_dia'
      var agendaInfo = checkPatientAgendaStatus(contact)
      var hasAgendaCoverage = agendaInfo.hasActiveFuture || agendaInfo.hasRecentRealizado

      if (contact.getBool('is_patient') && !hasAgendaCoverage) {
        var convertedAt = contact.getString('converted_at')
        if (convertedAt) {
          var convTs = Math.floor(new Date(convertedAt).getTime() / 1000)
          var daysSince = Math.floor((nowTs - convTs) / 86400)
          var fRuleId = contact.getString('followup_rule_id') || ''
          var fDays = 10
          if (fRuleId && rulesById[fRuleId]) fDays = rulesById[fRuleId]
          if (daysSince >= fDays) careStatus = 'precisa_retorno'
        }
      }

      // Aplica os limiares de follow-up configurados (sem resposta por
      // N dias → "nao_respondeu"; por M dias → "precisa_atencao"; por
      // P dias → "perdido"). Baseia-se na última sincronização de
      // atividade do contato (last_synced_at), que reflete o último
      // contato registrado.
      var lastSynced = contact.getString('last_synced_at')
      if (lastSynced) {
        var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
        if (!isNaN(lastTs)) {
          var daysNoResponse = Math.floor((nowTs - lastTs) / 86400)
          var thresholds = getThresholds(accountId)
          if (daysNoResponse >= thresholds.perdido) {
            careStatus = 'perdido'
          } else if (daysNoResponse >= thresholds.precisa_atencao) {
            careStatus = 'precisa_atencao'
          } else if (daysNoResponse >= thresholds.nao_respondeu) {
            careStatus = 'nao_respondeu'
          } else if (daysNoResponse >= 30) {
            careStatus = 'sem_contato_' + daysNoResponse + '_dias'
          }
        }
      }

      contact.set('care_status', careStatus)
      contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))
      try {
        $app.saveNoValidate(contact)
      } catch (_) {}
      totalProcessed++
    }
  }

  if (totalProcessed > 0) {
    $app
      .logger()
      .info('daily_reclassify_done', 'processed', totalProcessed, 'classified', totalClassified)
  }
})
