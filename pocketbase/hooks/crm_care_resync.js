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
        500,
        0,
        { accId: accountId },
      )
      for (var r = 0; r < recentMsgs.length; r++) {
        var rj = recentMsgs[r].getString('remote_jid')
        if (rj && !lastMsgByJid[rj]) {
          lastMsgByJid[rj] = {
            from_me: recentMsgs[r].getBool('from_me'),
            timestamp: recentMsgs[r].getInt('timestamp') || 0,
          }
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
          var transcript = messages
            .slice()
            .reverse()
            .map(function (m) {
              var from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
              return from + ': ' + (m.getString('content') || '[mídia]')
            })
            .join('\n')

          var contactName =
            contact.getString('contact_name') || contact.getString('push_name') || jid

          try {
            var reply = $ai.chat({
              model: 'fast',
              messages: [
                {
                  role: 'system',
                  content:
                    'Você é um assistente de CRM. Analise a conversa do WhatsApp e classifique o contato. Responda APENAS em JSON válido com os campos: stage (um de: lead, em_atendimento, cliente, nao_respondido), role (um de: paciente, nao_paciente), is_patient (boolean: true se o contato é paciente/cliente que fechou consulta), conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta), suggested_action (breve próxima ação recomendada, max 120 chars), priority (número 1-10, onde 10 é urgente).',
                },
                {
                  role: 'user',
                  content: 'Contato: ' + contactName + '\n\nTranscrição:\n' + transcript,
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
      var lm = lastMsgByJid[cJid]
      if (lm && lm.from_me && lm.timestamp > 0 && nowTs - lm.timestamp >= 8 * 3600)
        cats.push('nao_respondeu')
      else if (!lm && cCare !== 'em_dia') cats.push('nao_respondeu')
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

      for (var t = 0; t < exTasks.length; t++) {
        if (cats.indexOf(exTasks[t].getString('care_category')) < 0) {
          exTasks[t].set('status', 'concluida')
          exTasks[t].set('completed_at', new Date().toISOString())
          $app.saveNoValidate(exTasks[t])
          tasksCompleted++
        }
      }

      for (var cc = 0; cc < cats.length; cc++) {
        var cat = cats[cc],
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
          $app.saveNoValidate(found)
          tasksUpdated++
        } else {
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
