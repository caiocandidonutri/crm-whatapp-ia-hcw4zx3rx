cronAdd('sync_care_tasks', '0 * * * *', () => {
  var accounts = []
  try {
    accounts = $app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
  } catch (_) {
    return
  }

  if (!accounts || accounts.length === 0) return

  var nowTs = Math.floor(Date.now() / 1000)
  var twentyFourHoursAgo = nowTs - 86400

  var categoryLabels = {
    nao_respondeu: 'Não respondeu',
    precisa_retorno: 'Precisa retorno',
    precisa_consulta: 'Precisa consulta',
    precisa_atencao: 'Precisa atenção',
    followup_10_15: 'Follow-up 10-15 dias',
    alta_demanda: 'Alta demanda',
  }

  var tasksCreated = 0
  var tasksUpdated = 0
  var tasksCompleted = 0

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
      var highVolumeMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'account_id = {:accId} && from_me = false && timestamp >= {:ts}',
        '-timestamp',
        1000,
        0,
        { accId: accountId, ts: twentyFourHoursAgo },
      )
      var msgCounts = {}
      for (var h = 0; h < highVolumeMsgs.length; h++) {
        var hjid = highVolumeMsgs[h].getString('remote_jid')
        if (hjid && hjid.indexOf('@g.us') < 0 && hjid !== 'status@broadcast') {
          msgCounts[hjid] = (msgCounts[hjid] || 0) + 1
        }
      }
      for (var mk in msgCounts) {
        if (msgCounts[mk] >= 10) altaDemandaJids.push(mk)
      }
    } catch (_) {}

    var rulesById = {}
    try {
      var allRules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 500, 0)
      for (var rl = 0; rl < allRules.length; rl++) {
        rulesById[allRules[rl].id] = allRules[rl].getInt('followup_days') || 10
      }
    } catch (_) {}

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i]
      var jid = contact.getString('jid') || ''
      var instanceName = contact.getString('instance_name') || ''

      // Validação estrita de JID: só criar tarefa se terminar em @s.whatsapp.net e ter entre 10 e 13 dígitos
      // Descartar @lid, @g.us, status@broadcast
      if (!jid || !jid.endsWith('@s.whatsapp.net')) continue
      var jidDigits = jid.split('@')[0]
      if (!/^\d{10,13}$/.test(jidDigits)) continue

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
      var contactName =
        contact.getString('contact_name') || contact.getString('push_name') || jid || 'Contato'
      var careStatus = contact.getString('care_status') || 'em_dia'
      var stage = contact.getString('stage') || ''
      var aiAction = contact.getString('ai_suggested_action') || ''
      var aiPriority = contact.getInt('ai_priority') || 0
      var isPatient = contact.getBool('is_patient')
      var convertedAt = contact.getString('converted_at') || ''
      var followupRuleId = contact.getString('followup_rule_id') || ''
      var userId = contact.getString('user_id')

      var followupDays = 10
      if (followupRuleId && rulesById[followupRuleId]) {
        followupDays = rulesById[followupRuleId]
      }

      var conversationId = ''
      try {
        var conv = $app.findFirstRecordByFilter(
          'conversations',
          'instance_name = {:inst} && remote_jid = {:jid}',
          { inst: instanceName, jid: jid },
        )
        if (conv) conversationId = conv.id
      } catch (_) {}

      var currentCategories = []

      if (careStatus === 'precisa_retorno') {
        currentCategories.push('precisa_retorno')
      }

      var isNR = false
      var mInfo = lastMsgByJid[jid]
      if (mInfo) {
        if (
          mInfo.last_from_me_ts > 0 &&
          mInfo.last_patient_ts <= mInfo.last_from_me_ts &&
          nowTs - mInfo.last_from_me_ts >= 8 * 3600
        ) {
          isNR = true
        }
      } else if (careStatus === 'nao_respondeu') {
        isNR = true
      }
      if (isNR) {
        currentCategories.push('nao_respondeu')
      }

      if (aiAction && aiPriority >= 5) {
        currentCategories.push('precisa_atencao')
      }

      if (stage === 'em_atendimento' && !convertedAt) {
        currentCategories.push('precisa_consulta')
      }

      if (isPatient && convertedAt) {
        var convTs = Math.floor(new Date(convertedAt).getTime() / 1000)
        if (!isNaN(convTs)) {
          var daysSince = Math.floor((nowTs - convTs) / 86400)
          if (daysSince >= followupDays && daysSince <= followupDays + 5) {
            currentCategories.push('followup_10_15')
          }
        }
      }

      if (altaDemandaJids.indexOf(jid) >= 0) {
        currentCategories.push('alta_demanda')
      }

      var taskPriority = 'baixa'
      if (aiPriority >= 9) taskPriority = 'urgente'
      else if (aiPriority >= 7) taskPriority = 'alta'
      else if (aiPriority >= 4) taskPriority = 'media'

      // Deduplicação estrita: seleciona apenas a categoria mais grave
      var primaryCategory = null
      var severityOrder = [
        'alta_demanda',
        'precisa_consulta',
        'precisa_atencao',
        'precisa_retorno',
        'nao_respondeu',
        'followup_10_15',
      ]
      for (var sIdx = 0; sIdx < severityOrder.length; sIdx++) {
        if (currentCategories.indexOf(severityOrder[sIdx]) >= 0) {
          primaryCategory = severityOrder[sIdx]
          break
        }
      }
      var targetCategories = primaryCategory ? [primaryCategory] : []

      var existingTasks = []
      try {
        existingTasks = $app.findRecordsByFilter(
          'tasks',
          'crm_contact_id = {:cid} && care_category != "" && care_category != "sem_categoria" && status != "concluida" && status != "cancelada"',
          '-created',
          50,
          0,
          { cid: contact.id },
        )
      } catch (_) {}

      // Conclui qualquer tarefa pendente que não seja a categoria primária selecionada
      for (var t = 0; t < existingTasks.length; t++) {
        var existingTask = existingTasks[t]
        var taskCategory = existingTask.getString('care_category')
        if (targetCategories.indexOf(taskCategory) < 0) {
          existingTask.set('status', 'concluida')
          existingTask.set('completed_at', new Date().toISOString())
          $app.saveNoValidate(existingTask)
          tasksCompleted++
        }
      }

      for (var c = 0; c < targetCategories.length; c++) {
        var category = targetCategories[c]
        var label = categoryLabels[category] || category
        var title = label + ': ' + contactName
        var contactAssignedTo = contact.getString('assigned_to') || ''
        var nextDayDate = new Date(Date.now() + 86400000).toISOString()
        var cutoff36hIso = new Date(Date.now() - 36 * 3600 * 1000).toISOString()

        var foundTask = null
        for (var t2 = 0; t2 < existingTasks.length; t2++) {
          if (existingTasks[t2].getString('care_category') === category) {
            foundTask = existingTasks[t2]
            break
          }
        }

        if (foundTask) {
          foundTask.set('title', title)
          foundTask.set('priority', taskPriority)
          if (conversationId) foundTask.set('conversation_id', conversationId)
          if (aiAction) foundTask.set('description', aiAction)
          if (!foundTask.getString('due_date')) foundTask.set('due_date', nextDayDate)
          if (contactAssignedTo && !foundTask.getString('assigned_to')) {
            foundTask.set('assigned_to', contactAssignedTo)
          }
          $app.saveNoValidate(foundTask)
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
              { cid: contact.id, cat: category, cutoff: cutoff36hIso },
            )
            if (recentDone && recentDone.length > 0) {
              hasRecentCompleted = true
            }
          } catch (_) {}

          if (hasRecentCompleted) continue

          // Idempotência preventiva: verifica se já existe QUALQUER tarefa ativa para este contato
          var alreadyExists = false
          try {
            var checkActive = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && (status = 'pendente' || status = 'em_andamento')",
              '-created',
              1,
              0,
              { cid: contact.id },
            )
            if (checkActive && checkActive.length > 0) {
              alreadyExists = true
            }
          } catch (_) {}

          if (alreadyExists) continue

          try {
            var taskCol = $app.findCollectionByNameOrId('tasks')
            var newTask = new Record(taskCol)
            newTask.set('user_id', userId)
            newTask.set('account_id', accountId)
            newTask.set('title', title)
            newTask.set('status', 'pendente')
            newTask.set('priority', taskPriority)
            newTask.set('care_category', category)
            newTask.set('crm_contact_id', contact.id)
            newTask.set('due_date', nextDayDate)
            if (contactAssignedTo) newTask.set('assigned_to', contactAssignedTo)
            if (conversationId) newTask.set('conversation_id', conversationId)
            if (aiAction) newTask.set('description', aiAction)
            $app.saveNoValidate(newTask)
            tasksCreated++
          } catch (createErr) {
            $app.logger().error('sync_care_tasks: create failed', 'error', String(createErr))
          }
        }
      }
    }
  }

  if (tasksCreated > 0 || tasksUpdated > 0 || tasksCompleted > 0) {
    $app
      .logger()
      .info(
        'sync_care_tasks_done',
        'created',
        tasksCreated,
        'updated',
        tasksUpdated,
        'completed',
        tasksCompleted,
      )
  }
})
