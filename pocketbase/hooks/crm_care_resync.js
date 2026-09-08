routerAdd(
  'POST',
  '/backend/v1/crm-care/resync',
  (e) => {
    var userId = e.auth && e.auth.id
    if (!userId) return e.unauthorizedError('auth required')

    var accountId = ''
    try {
      var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
        uid: userId,
      })
      accountId = member.getString('account_id')
    } catch (_) {}

    if (!accountId) {
      return e.json(200, {
        success: true,
        contacts_processed: 0,
        ai_classified: 0,
        tasks_created: 0,
        tasks_updated: 0,
        tasks_completed: 0,
      })
    }

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
      return e.json(200, {
        success: true,
        contacts_processed: 0,
        ai_classified: 0,
        tasks_created: 0,
        tasks_updated: 0,
        tasks_completed: 0,
      })
    }

    var nowTs = Math.floor(Date.now() / 1000)
    var fortyEightHoursAgo = nowTs - 48 * 3600
    var twentyFourHoursAgo = nowTs - 86400

    var rulesById = {}
    try {
      var allRules = $app.findRecordsByFilter('care_followup_rules', "id != ''", 'created', 500, 0)
      for (var rl = 0; rl < allRules.length; rl++) {
        rulesById[allRules[rl].id] = allRules[rl].getInt('followup_days') || 10
      }
    } catch (_) {}

    var lastMsgByJid = {}
    try {
      var recentMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'account_id = {:accId}',
        '-timestamp',
        1000,
        0,
        { accId: accountId },
      )
      for (var r = 0; r < recentMsgs.length; r++) {
        var rj = recentMsgs[r].getString('remote_jid')
        if (!rj) continue
        if (!lastMsgByJid[rj]) {
          lastMsgByJid[rj] = {
            last_from_me_ts: 0,
            last_patient_ts: 0,
          }
        }
        var mTs = recentMsgs[r].getInt('timestamp') || 0
        if (recentMsgs[r].getBool('from_me')) {
          if (mTs > lastMsgByJid[rj].last_from_me_ts) lastMsgByJid[rj].last_from_me_ts = mTs
        } else {
          if (mTs > lastMsgByJid[rj].last_patient_ts) lastMsgByJid[rj].last_patient_ts = mTs
        }
      }
    } catch (_) {}

    var altaDemandaJids = []
    try {
      var hvMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'account_id = {:accId} && from_me = false && timestamp >= {:ts}',
        '-timestamp',
        1000,
        0,
        { accId: accountId, ts: twentyFourHoursAgo },
      )
      var msgCounts = {}
      for (var h = 0; h < hvMsgs.length; h++) {
        var hjid = hvMsgs[h].getString('remote_jid')
        if (hjid && hjid.indexOf('@g.us') < 0 && hjid !== 'status@broadcast') {
          msgCounts[hjid] = (msgCounts[hjid] || 0) + 1
        }
      }
      for (var mk in msgCounts) {
        if (msgCounts[mk] >= 10) altaDemandaJids.push(mk)
      }
    } catch (_) {}

    var aiClassified = 0

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i]
      var jid = contact.getString('jid') || ''
      var instanceName = contact.getString('instance_name') || ''

      if (aiClassified < 30 && jid && instanceName) {
        var messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst} && timestamp >= {:ts}',
            '-timestamp',
            15,
            0,
            { jid: jid, inst: instanceName, ts: fortyEightHoursAgo },
          )
        } catch (_) {}

        if (messages.length > 0) {
          function formatMessageContent(m) {
            var content = m.getString('content')
            if (content && content.trim()) return content.trim()
            var transcription = m.getString('transcription')
            if (transcription && transcription.trim()) {
              return '[áudio transcrito: ' + transcription.trim() + ']'
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

          try {
            var pStage = contact.getString('stage') || 'lead'
            var pCare = contact.getString('care_status') || 'em_dia'
            var sysPrompt =
              'Você é o assistente de CRM da clínica de nutrição do Dr. Caio Cândido.\n' +
              'Papéis: "Dr. Caio" é o nutricionista; "Fabiana" é a secretária/assistente; eles NUNCA são pacientes.\n' +
              'Regras de Follow-up cadastradas: Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d).\n' +
              'Vocabulário: SOP, plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica.\n' +
              'Responda APENAS em JSON válido com os campos: stage (lead, em_atendimento, cliente, nao_respondido), role (paciente, nao_paciente), is_patient (boolean), conversion_detected (boolean), suggested_action (max 120 chars), priority (número 1-10).'

            var userContent =
              'Paciente/Contato: ' +
              contactName +
              '\n' +
              'Estágio: ' +
              pStage +
              ' | Cuidado: ' +
              pCare +
              '\n\n' +
              'Transcrição:\n' +
              transcript

            var reply = $ai.chat({
              model: 'fast',
              messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userContent },
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
                if (aiResult.stage && validStages.indexOf(aiResult.stage) >= 0)
                  contact.set('stage', aiResult.stage)
                if (aiResult.role === 'paciente' || aiResult.role === 'nao_paciente')
                  contact.set('role', aiResult.role)

                var conversionDetected = aiResult.conversion_detected === true
                var isPatient = aiResult.is_patient === true

                if (conversionDetected || isPatient) {
                  if (!contact.getBool('is_patient')) contact.set('is_patient', true)
                  if (!contact.getString('converted_at'))
                    contact.set('converted_at', new Date().toISOString().split('T')[0])
                  if (conversionDetected) contact.set('stage', 'cliente')
                }

                if (aiResult.suggested_action)
                  contact.set(
                    'ai_suggested_action',
                    String(aiResult.suggested_action).substring(0, 500),
                  )
                if (aiResult.priority !== undefined) {
                  var pri = Number(aiResult.priority)
                  if (Number.isFinite(pri))
                    contact.set('ai_priority', Math.min(Math.max(pri, 1), 10))
                }
                aiClassified++
              }
            }
          } catch (_) {}
        }
      }

      var careStatus = 'em_dia'
      if (contact.getBool('is_patient')) {
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
      contact.set('care_status', careStatus)
      contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))
      try {
        $app.saveNoValidate(contact)
      } catch (_) {}
    }

    var categoryLabels = {
      nao_respondeu: 'Não respondeu',
      precisa_retorno: 'Precisa retorno',
      precisa_consulta: 'Precisa consulta',
      precisa_atencao: 'Precisa atenção',
      followup_10_15: 'Follow-up 10-15 dias',
      alta_demanda: 'Alta demanda',
    }
    var tasksCreated = 0,
      tasksUpdated = 0,
      tasksCompleted = 0

    for (var k = 0; k < contacts.length; k++) {
      var c = contacts[k]
      var cJid = c.getString('jid') || '',
        cInst = c.getString('instance_name') || ''

      if (!cInst) continue
      try {
        var instRec = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name}',
          { name: cInst },
        )
        if (!instRec || instRec.getString('status') !== 'connected') {
          continue
        }
      } catch (_) {
        // Instância inexistente ou erro = desconectada, pular
        continue
      }
      var cName = c.getString('contact_name') || c.getString('push_name') || cJid || 'Contato'
      var cCare = c.getString('care_status') || 'em_dia',
        cStage = c.getString('stage') || ''
      var cAction = c.getString('ai_suggested_action') || '',
        cPri = c.getInt('ai_priority') || 0
      var cPatient = c.getBool('is_patient'),
        cConvAt = c.getString('converted_at') || ''
      var cFRule = c.getString('followup_rule_id') || '',
        cUser = c.getString('user_id')
      var cFDays = 10
      if (cFRule && rulesById[cFRule]) cFDays = rulesById[cFRule]

      var convId = ''
      try {
        var conv = $app.findFirstRecordByFilter(
          'conversations',
          'instance_name = {:inst} && remote_jid = {:jid}',
          { inst: cInst, jid: cJid },
        )
        if (conv) convId = conv.id
      } catch (_) {}

      var cats = []
      if (cCare === 'precisa_retorno') cats.push('precisa_retorno')
      var isNR = false
      var mInfo = lastMsgByJid[cJid]
      if (mInfo) {
        if (
          mInfo.last_from_me_ts > 0 &&
          mInfo.last_patient_ts <= mInfo.last_from_me_ts &&
          nowTs - mInfo.last_from_me_ts >= 8 * 3600
        ) {
          isNR = true
        }
      } else if (cCare === 'nao_respondeu') {
        isNR = true
      }
      if (isNR) cats.push('nao_respondeu')
      if (cAction && cPri >= 5) cats.push('precisa_atencao')
      if (cStage === 'em_atendimento' && !cConvAt) cats.push('precisa_consulta')
      if (cPatient && cConvAt) {
        var ct = Math.floor(new Date(cConvAt).getTime() / 1000)
        if (!isNaN(ct)) {
          var ds = Math.floor((nowTs - ct) / 86400)
          if (ds >= cFDays && ds <= cFDays + 5) cats.push('followup_10_15')
        }
      }
      if (altaDemandaJids.indexOf(cJid) >= 0) cats.push('alta_demanda')

      var tp = 'baixa'
      if (cPri >= 9) tp = 'urgente'
      else if (cPri >= 7) tp = 'alta'
      else if (cPri >= 4) tp = 'media'

      // Deduplicação estrita: seleciona apenas a categoria mais grave
      var primaryCat = null
      var severityOrder = [
        'alta_demanda',
        'precisa_consulta',
        'precisa_atencao',
        'precisa_retorno',
        'nao_respondeu',
        'followup_10_15',
      ]
      for (var sIdx = 0; sIdx < severityOrder.length; sIdx++) {
        if (cats.indexOf(severityOrder[sIdx]) >= 0) {
          primaryCat = severityOrder[sIdx]
          break
        }
      }
      var targetCats = primaryCat ? [primaryCat] : []

      var exTasks = []
      try {
        exTasks = $app.findRecordsByFilter(
          'tasks',
          "crm_contact_id = {:cid} && care_category != '' && care_category != 'sem_categoria' && status != 'concluida' && status != 'cancelada'",
          '-created',
          50,
          0,
          { cid: c.id },
        )
      } catch (_) {}

      // Conclui tarefas que não são a categoria primária
      for (var t = 0; t < exTasks.length; t++) {
        if (targetCats.indexOf(exTasks[t].getString('care_category')) < 0) {
          exTasks[t].set('status', 'concluida')
          exTasks[t].set('completed_at', new Date().toISOString())
          $app.saveNoValidate(exTasks[t])
          tasksCompleted++
        }
      }

      var cAssignedTo = c.getString('assigned_to') || ''
      var nextDayDate = new Date(Date.now() + 86400000).toISOString()
      var cutoff36hIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString()

      for (var cc = 0; cc < targetCats.length; cc++) {
        var cat = targetCats[cc],
          title = (categoryLabels[cat] || cat) + ': ' + cName
        var found = null
        for (var t2 = 0; t2 < exTasks.length; t2++) {
          if (exTasks[t2].getString('care_category') === cat) {
            found = exTasks[t2]
            break
          }
        }
        if (found) {
          found.set('title', title)
          found.set('priority', tp)
          if (convId) found.set('conversation_id', convId)
          if (cAction) found.set('description', cAction)
          if (!found.getString('due_date')) found.set('due_date', nextDayDate)
          if (cAssignedTo && !found.getString('assigned_to')) found.set('assigned_to', cAssignedTo)
          $app.saveNoValidate(found)
          tasksUpdated++
        } else {
          // Item 1: MEMÓRIA DE CONCLUSÃO — verificar se existe tarefa da MESMA care_category
          // para o mesmo crm_contact_id com status='concluida' nas últimas 36h
          var hasRecentCompleted = false
          try {
            var recentDone = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && care_category = {:cat} && status = 'concluida' && (completed_at >= {:cutoff} || updated >= {:cutoff})",
              '-updated',
              1,
              0,
              { cid: c.id, cat: cat, cutoff: cutoff36hIso },
            )
            if (recentDone && recentDone.length > 0) {
              hasRecentCompleted = true
            }
          } catch (_) {}

          if (hasRecentCompleted) continue

          // Idempotência: verifica se já existe tarefa ativa antes de criar
          var alreadyExists = false
          try {
            var checkActive = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && (status = 'pendente' || status = 'em_andamento')",
              '-created',
              1,
              0,
              { cid: c.id },
            )
            if (checkActive && checkActive.length > 0) {
              alreadyExists = true
            }
          } catch (_) {}

          if (alreadyExists) continue

          try {
            var tc = $app.findCollectionByNameOrId('tasks'),
              nt = new Record(tc)
            nt.set('user_id', cUser)
            nt.set('account_id', accountId)
            nt.set('title', title)
            nt.set('status', 'pendente')
            nt.set('priority', tp)
            nt.set('care_category', cat)
            nt.set('crm_contact_id', c.id)
            nt.set('due_date', nextDayDate)
            if (cAssignedTo) nt.set('assigned_to', cAssignedTo)
            if (convId) nt.set('conversation_id', convId)
            if (cAction) nt.set('description', cAction)
            $app.saveNoValidate(nt)
            tasksCreated++
          } catch (_) {}
        }
      }
    }

    $app
      .logger()
      .info(
        'crm_care_resync',
        'account',
        accountId,
        'contacts',
        contacts.length,
        'ai',
        aiClassified,
        'created',
        tasksCreated,
        'updated',
        tasksUpdated,
        'completed',
        tasksCompleted,
      )

    return e.json(200, {
      success: true,
      contacts_processed: contacts.length,
      ai_classified: aiClassified,
      tasks_created: tasksCreated,
      tasks_updated: tasksUpdated,
      tasks_completed: tasksCompleted,
    })
  },
  $apis.requireAuth(),
)
