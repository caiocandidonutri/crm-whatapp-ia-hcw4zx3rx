onRecordAfterCreateSuccess((e) => {
  try {
    var msg = e.record
    if (msg.getBool('from_me')) return e.next()

    var remoteJid = msg.getString('remote_jid')
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
      return e.next()
    }

    var instanceName = msg.getString('instance_name')
    var userId = msg.getString('user_id')
    var nowTs = Math.floor(Date.now() / 1000)

    var contact = null
    try {
      contact = $app.findFirstRecordByFilter(
        'crm_contacts',
        'instance_name = {:inst} && jid = {:jid}',
        { inst: instanceName, jid: remoteJid },
      )
    } catch (_) {}

    if (contact) {
      // Regra 1: Não reclassificar se o contato já for cliente
      if (contact.getString('stage') === 'cliente') {
        return e.next()
      }

      // Regra 2: Cooldown de 6 HORAS por contato
      var lastReclassifiedStr = contact.getString('last_ai_reclassified_at')
      if (lastReclassifiedStr) {
        var lastReclassifiedTime = new Date(lastReclassifiedStr).getTime()
        var sixHoursMs = 6 * 3600 * 1000
        if (!isNaN(lastReclassifiedTime) && Date.now() - lastReclassifiedTime < sixHoursMs) {
          return e.next()
        }
      }

      var updatedStr = contact.getString('updated')
      if (updatedStr) {
        var updatedTime = new Date(updatedStr).getTime()
        if (!isNaN(updatedTime) && Date.now() - updatedTime < 30 * 1000) {
          return e.next()
        }
      }
    }

    // Regra 3: Teto diário de análises IA
    var accountId = msg.getString('account_id')
    var dNow = new Date()
    var utcNow = dNow.getTime() + dNow.getTimezoneOffset() * 60000
    var spTime = new Date(utcNow - 3 * 3600000)
    var dayKey =
      spTime.getFullYear() +
      '-' +
      String(spTime.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(spTime.getDate()).padStart(2, '0')
    var usageFilter = accountId
      ? "day_key = '" + dayKey + "' && account_id = '" + accountId + "'"
      : "day_key = '" + dayKey + "'"
    var uRec = null
    try {
      uRec = $app.findFirstRecordByFilter('app_daily_usage', usageFilter)
    } catch (_) {}
    if (uRec) {
      var aCount = uRec.getInt('ai_analyses_count') || 0
      var aLimit = uRec.getInt('ai_analyses_limit') || 200
      var aPaused = uRec.getBool('ai_analyses_paused')
      if (aPaused || aCount >= aLimit) {
        return e.next()
      }
    }

    if (!contact) {
      try {
        var accountId = msg.getString('account_id')
        var contactCol = $app.findCollectionByNameOrId('crm_contacts')
        contact = new Record(contactCol)
        contact.set('user_id', userId)
        if (accountId) contact.set('account_id', accountId)
        contact.set('instance_name', instanceName)
        contact.set('jid', remoteJid)
        contact.set('phone', remoteJid.split('@')[0])
        var rawPush = msg.getString('push_name') || ''
        var safePush = ''
        if (
          rawPush &&
          rawPush.trim() !== '.' &&
          !/^[.\-_*#@!?,:;~^`'"]+$/.test(rawPush.trim()) &&
          /[a-zA-Z\u00C0-\u017F]/.test(rawPush.trim())
        ) {
          var lp = rawPush.toLowerCase().trim()
          var isClinicOrBlocked =
            [
              'você',
              'voce',
              'eu',
              'you',
              'me',
              'i',
              'contato whatsapp',
              'sem nome',
              'null',
              'undefined',
              'desconhecido',
            ].indexOf(lp) !== -1 ||
            (lp.indexOf('fabiana') !== -1 && lp.indexOf('assistente') !== -1) ||
            (lp.indexOf('assistente') !== -1 &&
              (lp.indexOf('dr.') !== -1 ||
                lp.indexOf('dr ') !== -1 ||
                lp.indexOf('caio') !== -1 ||
                lp.indexOf('nutri') !== -1)) ||
            (lp.indexOf('dr. caio') !== -1 && lp.indexOf('nutri') !== -1)
          if (!isClinicOrBlocked) {
            safePush = rawPush.trim()
          }
        }
        contact.set('push_name', safePush)
        contact.set('contact_name', safePush)
        contact.set('stage', 'lead')
        contact.set('care_status', 'em_dia')
        $app.save(contact)
      } catch (createErr) {
        $app.logger().error('crm_care_realtime: create contact failed', 'error', String(createErr))
        return e.next()
      }
    }

    var messages = []
    try {
      messages = $app.findRecordsByFilter(
        'whatsapp_messages',
        'remote_jid = {:jid} && instance_name = {:inst}',
        '-timestamp',
        8,
        0,
        { jid: remoteJid, inst: instanceName },
      )
    } catch (_) {
      return e.next()
    }

    if (messages.length === 0) return e.next()

    function formatMessageContent(m) {
      var content = m.getString('content')
      if (content && content.trim()) {
        return content.trim().length > 300 ? content.trim().substring(0, 300) + '…' : content.trim()
      }
      var transcription = m.getString('transcription')
      if (transcription && transcription.trim() && transcription !== 'SKIP_NO_TRANSCRIBE') {
        var cut = transcription.trim()
        return '[áudio transcrito: ' + (cut.length > 200 ? cut.substring(0, 200) + '…' : cut) + ']'
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

    var rawContactName = contact.getString('contact_name') || contact.getString('push_name') || ''
    var isBadName =
      !rawContactName ||
      rawContactName.trim() === '.' ||
      /^[.\-_*#@!?,:;~^`'"]+$/.test(rawContactName.trim()) ||
      !/[a-zA-Z\u00C0-\u017F]/.test(rawContactName.trim()) ||
      (rawContactName.toLowerCase().indexOf('fabiana') !== -1 &&
        rawContactName.toLowerCase().indexOf('assistente') !== -1)
    var contactName = isBadName ? remoteJid.split('@')[0] : rawContactName

    var rulesDescriptionText =
      'Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d)'
    try {
      var allRules = $app.findRecordsByFilter('care_followup_rules', "id != ''", 'created', 50, 0)
      var ruleLines = []
      for (var rl = 0; rl < allRules.length; rl++) {
        var rName = allRules[rl].getString('name')
        var rDays = allRules[rl].getInt('followup_days') || 10
        if (rName) {
          ruleLines.push(rName + ' (' + rDays + 'd)')
        }
      }
      if (ruleLines.length > 0) {
        rulesDescriptionText = ruleLines.join(', ')
      }
    } catch (_) {}

    // Contexto do paciente e clínica
    var patientStage = contact.getString('stage') || 'lead'
    var patientCareStatus = contact.getString('care_status') || 'em_dia'
    var activeTasksCount = 0
    try {
      var actTasks = $app.findRecordsByFilter(
        'tasks',
        "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
        '-created',
        5,
        0,
        { cid: contact.id },
      )
      activeTasksCount = actTasks ? actTasks.length : 0
    } catch (_) {}

    var aiResult = null
    try {
      var systemPromptCare =
        'Você é o assistente de inteligência clínica e CRM da clínica de nutrição do Dr. Caio Cândido (especialista em saúde metabólica, hormonal feminina, SOP, emagrecimento e planos alimentares).\n' +
        'Papéis fundamentais da clínica:\n' +
        '- "Dr. Caio" / "Dr. Caio Cândido" é o nutricionista responsável pelas consultas e condutas.\n' +
        '- "Fabiana" é a assistente/secretária de atendimento e acolhimento.\n' +
        '- Dr. Caio e Fabiana NUNCA devem ser interpretados como pacientes; o paciente é o interlocutor externo na conversa.\n' +
        'Regras de Follow-up da clínica lidas do banco: ' +
        rulesDescriptionText +
        '.\n' +
        'Vocabulário nutricional/clínico relevante: SOP (Síndrome dos Ovários Policísticos), plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica, sintomas, exames.\n\n' +
        'Responda APENAS em JSON válido com os campos:\n' +
        'stage (um de: lead, em_atendimento, cliente, nao_respondido),\n' +
        'role (um de: paciente, nao_paciente),\n' +
        'is_patient (boolean: true se é paciente ou agendou consulta com Dr. Caio),\n' +
        'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta),\n' +
        'suggested_action (próxima ação clínica/atendimento sugerida, max 120 chars),\n' +
        'priority (número de 1 a 10, onde 10 é mais urgente).'
      var userPromptCare =
        'Paciente/Contato: ' +
        contactName +
        '\n' +
        'Estágio atual no pipeline: ' +
        patientStage +
        '\n' +
        'Status de cuidado atual: ' +
        patientCareStatus +
        '\n' +
        'Tarefas ativas de cuidado: ' +
        activeTasksCount +
        '\n\n' +
        'Histórico da Conversa:\n' +
        transcript

      var reply = $ai.chat({
        model: 'fast',
        messages: [
          { role: 'system', content: systemPromptCare },
          { role: 'user', content: userPromptCare },
        ],
      })

      // Incrementar contador de análises IA diário
      try {
        if (!uRec) {
          var uCol = $app.findCollectionByNameOrId('app_daily_usage')
          uRec = new Record(uCol)
          uRec.set('day_key', dayKey)
          if (accountId) uRec.set('account_id', accountId)
          uRec.set('transcriptions_count', 0)
          uRec.set('transcriptions_limit', 150)
          uRec.set('ai_analyses_count', 0)
          uRec.set('ai_analyses_limit', 200)
        }
        var nextCount = (uRec.getInt('ai_analyses_count') || 0) + 1
        uRec.set('ai_analyses_count', nextCount)
        if (nextCount >= (uRec.getInt('ai_analyses_limit') || 200)) {
          uRec.set('ai_analyses_paused', true)
        }
        $app.save(uRec)
      } catch (_) {}

      var rawText =
        reply.choices &&
        reply.choices[0] &&
        reply.choices[0].message &&
        reply.choices[0].message.content
      if (rawText) {
        var jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0])
        }
      }
    } catch (aiErr) {
      if (aiErr instanceof SkipAiConfigError) return e.next()
      $app.logger().error('crm_care_realtime: AI call failed', 'error', String(aiErr))
      return e.next()
    }

    if (!aiResult) return e.next()

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
      contact.set('ai_suggested_action', String(aiResult.suggested_action).substring(0, 500))
    }
    if (aiResult.priority !== undefined) {
      var priority = Number(aiResult.priority)
      if (Number.isFinite(priority)) {
        contact.set('ai_priority', Math.min(Math.max(priority, 1), 10))
      }
    }

    var nowIso = new Date().toISOString()
    var threeMonthsAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    var cPhone = (contact.getString('phone') || '').replace(/\D/g, '')
    var cJid = (contact.getString('jid') || '').replace(/\D/g, '')
    var suf1 = cPhone.length >= 8 ? cPhone.slice(-8) : ''
    var suf2 = cJid.length >= 8 ? cJid.slice(-8) : ''

    var filterParts = ["patient_id = '" + contact.id + "'"]
    if (suf1) filterParts.push("patient_phone ~ '" + suf1 + "'")
    if (suf2 && suf2 !== suf1) filterParts.push("patient_phone ~ '" + suf2 + "'")

    var appts = []
    try {
      appts = $app.findRecordsByFilter(
        'appointments',
        '(' + filterParts.join(' || ') + ')',
        '-starts_at',
        20,
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
      if (sAt > nowIso && (st === 'agendado' || st === 'confirmado')) hasActiveFuture = true
      if (sAt <= nowIso && sAt >= threeMonthsAgoIso && st === 'realizado') hasRecentRealizado = true
    }
    var hasAgendaCoverage = hasActiveFuture || hasRecentRealizado

    var careStatus = 'em_dia'
    if (contact.getBool('is_patient') && !hasAgendaCoverage) {
      var convertedAt = contact.getString('converted_at')
      if (convertedAt) {
        var convertedTs = Math.floor(new Date(convertedAt).getTime() / 1000)
        var daysSinceConsultation = Math.floor((nowTs - convertedTs) / 86400)
        if (daysSinceConsultation >= 10) {
          careStatus = 'precisa_retorno'
        }
      }
    }
    contact.set('care_status', careStatus)
    var nowIsoStr = new Date().toISOString().replace('T', ' ')
    contact.set('last_ai_reclassified_at', nowIsoStr)
    contact.set('last_synced_at', nowIsoStr)

    try {
      $app.saveNoValidate(contact)
    } catch (saveErr) {
      $app.logger().error('crm_care_realtime: save failed', 'error', String(saveErr))
    }
  } catch (err) {
    $app.logger().error('crm_care_realtime: unexpected error', 'error', String(err))
  }

  return e.next()
}, 'whatsapp_messages')
