// Reclassifica as tarefas de cuidado de um contato quando seu estado de
// cuidado (care_status), etapa (stage) ou campos de IA mudam no backend.
//
// O Kanban de Tarefas (/tarefas) é alimentado pela coleção `tasks` com
// `care_category`. Essas tarefas são criadas/fechadas em batch pelo cron
// `sync_care_tasks` e pelo endpoint `crm-care/resync` — mas entre as
// execuções do cron, mudanças pontuais de care_status/stage (ex.: paciente
// respondeu uma conversa, IA detectou urgência, consulta confirmada)
// deixavam as tarefas desatualizadas até o próximo run horário.
//
// Este hook roda em cada update de `crm_contacts`, recalcula as categorias
// de cuidado atuais do contato (mesma lógica do sync_care_tasks) e
// ajusta as tarefas pendentes: conclui as que não se aplicam mais e cria
// as novas — sem precisar do reload manual (botão "Re-sincronizar").
//
// É O(1) por contato (só lê/ escreve as tarefas daquele contato) e
// inerte quando nada mudou, então é seguro rodar em todo update.

onRecordAfterUpdateSuccess((e) => {
  var contact = e.record

  // Só recalcula se algum campo relevante mudou — evita trabalho
  // desnecessário em updates que só tocaram notes/avatar/etc.
  var orig = contact.original()
  var relevantFields = [
    'care_status',
    'stage',
    'is_patient',
    'converted_at',
    'ai_suggested_action',
    'ai_priority',
    'followup_rule_id',
    'last_synced_at',
  ]
  var changed = false
  for (var i = 0; i < relevantFields.length; i++) {
    if (contact.getString(relevantFields[i]) !== orig.getString(relevantFields[i])) {
      changed = true
      break
    }
  }
  if (!changed) return e.next()

  var contactId = contact.id
  var accountId = contact.getString('account_id') || ''
  var userId = contact.getString('user_id') || ''
  var jid = contact.getString('jid') || ''
  var instanceName = contact.getString('instance_name') || ''
  var contactName =
    contact.getString('contact_name') || contact.getString('push_name') || jid || 'Contato'

  var nowTs = Math.floor(Date.now() / 1000)

  // --- Follow-up days (regra da conta, default 10) ---
  var followupDays = 10
  var fRuleId = contact.getString('followup_rule_id') || ''
  if (fRuleId) {
    try {
      var rule = $app.findRecordById('care_followup_rules', fRuleId)
      if (rule) followupDays = rule.getInt('followup_days') || 10
    } catch (_) {}
  }

  // --- Análise de mensagens para detecção correta de "não respondeu" ---
  // Um contato só é considerado "não respondeu" se a ÚLTIMA mensagem do atendente
  // (from_me = true) tem >= 8 horas E NÃO EXISTE nenhuma mensagem posterior do paciente (from_me = false).
  // Se o paciente respondeu depois do atendente falar (ou se o atendente nunca mandou mensagem),
  // ele NÃO está em "não respondeu".
  var isNaoRespondeu = false
  try {
    var latestMsgs = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst}',
      '-timestamp',
      20,
      0,
      { jid: jid, inst: instanceName },
    )
    if (latestMsgs && latestMsgs.length > 0) {
      var lastFromMeTs = 0
      var lastPatientTs = 0
      for (var lmIdx = 0; lmIdx < latestMsgs.length; lmIdx++) {
        var mItem = latestMsgs[lmIdx]
        var mTs = mItem.getInt('timestamp') || 0
        if (mItem.getBool('from_me')) {
          if (mTs > lastFromMeTs) lastFromMeTs = mTs
        } else {
          if (mTs > lastPatientTs) lastPatientTs = mTs
        }
      }

      // Atendente enviou mensagem há >= 8h e o paciente NÃO enviou nenhuma mensagem depois dela
      if (lastFromMeTs > 0 && lastPatientTs <= lastFromMeTs && nowTs - lastFromMeTs >= 8 * 3600) {
        isNaoRespondeu = true
      }
    } else if (careStatus === 'nao_respondeu') {
      isNaoRespondeu = true
    }
  } catch (_) {}

  // --- Conta de mensagens nas últimas 24h (para "alta demanda") ---
  var isAltaDemanda = false
  try {
    var twentyFourHoursAgo = nowTs - 86400
    var hvMsgs = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = false && timestamp >= {:ts}',
      '-timestamp',
      15,
      0,
      { jid: jid, inst: instanceName, ts: twentyFourHoursAgo },
    )
    // 15 já cobre o limiar de alta demanda (>=10); se vier 15, assume true.
    if (hvMsgs && hvMsgs.length >= 10) isAltaDemanda = true
  } catch (_) {}

  // --- Conversation id (para vincular a tarefa à conversa) ---
  var conversationId = ''
  try {
    var conv = $app.findFirstRecordByFilter(
      'conversations',
      'instance_name = {:inst} && remote_jid = {:jid}',
      { inst: instanceName, jid: jid },
    )
    if (conv) conversationId = conv.id
  } catch (_) {}

  // --- Recalcula as categorias atuais (espelha sync_care_tasks) ---
  var careStatus = contact.getString('care_status') || 'em_dia'
  var stage = contact.getString('stage') || ''
  var aiAction = contact.getString('ai_suggested_action') || ''
  var aiPriority = contact.getInt('ai_priority') || 0
  var isPatient = contact.getBool('is_patient')
  var convertedAt = contact.getString('converted_at') || ''

  var currentCategories = []

  if (careStatus === 'precisa_retorno') {
    currentCategories.push('precisa_retorno')
  }

  if (isNaoRespondeu) {
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

  if (isAltaDemanda) {
    currentCategories.push('alta_demanda')
  }

  var taskPriority = 'baixa'
  if (aiPriority >= 9) taskPriority = 'urgente'
  else if (aiPriority >= 7) taskPriority = 'alta'
  else if (aiPriority >= 4) taskPriority = 'media'

  var categoryLabels = {
    nao_respondeu: 'Não respondeu',
    precisa_retorno: 'Precisa retorno',
    precisa_consulta: 'Precisa consulta',
    precisa_atencao: 'Precisa atenção',
    followup_10_15: 'Follow-up 10-15 dias',
    alta_demanda: 'Alta demanda',
  }

  // --- Carrega tarefas existentes deste contato (cuidado, não concluídas) ---
  var existingTasks = []
  try {
    existingTasks = $app.findRecordsByFilter(
      'tasks',
      "crm_contact_id = {:cid} && care_category != '' && care_category != 'sem_categoria' && status != 'concluida' && status != 'cancelada'",
      '-created',
      50,
      0,
      { cid: contactId },
    )
  } catch (_) {}

  // --- Conclui tarefas cuja categoria não se aplica mais ---
  for (var t = 0; t < existingTasks.length; t++) {
    var exTask = existingTasks[t]
    var exCat = exTask.getString('care_category')
    if (currentCategories.indexOf(exCat) < 0) {
      exTask.set('status', 'concluida')
      exTask.set('completed_at', new Date().toISOString())
      try {
        $app.saveNoValidate(exTask)
      } catch (_) {}
    }
  }

  // --- Cria/atualiza tarefas para cada categoria atual ---
  for (var c = 0; c < currentCategories.length; c++) {
    var category = currentCategories[c]
    var label = categoryLabels[category] || category
    var title = label + ': ' + contactName

    var foundTask = null
    for (var t2 = 0; t2 < existingTasks.length; t2++) {
      if (existingTasks[t2].getString('care_category') === category) {
        foundTask = existingTasks[t2]
        break
      }
    }

    if (foundTask) {
      // Atualiza título/prioridade/descrição se mudaram.
      var dirty = false
      if (foundTask.getString('title') !== title) {
        foundTask.set('title', title)
        dirty = true
      }
      if (foundTask.getString('priority') !== taskPriority) {
        foundTask.set('priority', taskPriority)
        dirty = true
      }
      if (conversationId && foundTask.getString('conversation_id') !== conversationId) {
        foundTask.set('conversation_id', conversationId)
        dirty = true
      }
      if (aiAction && foundTask.getString('description') !== aiAction) {
        foundTask.set('description', aiAction)
        dirty = true
      }
      if (dirty) {
        try {
          $app.saveNoValidate(foundTask)
        } catch (_) {}
      }
    } else {
      try {
        var taskCol = $app.findCollectionByNameOrId('tasks')
        var newTask = new Record(taskCol)
        newTask.set('user_id', userId)
        if (accountId) newTask.set('account_id', accountId)
        newTask.set('title', title)
        newTask.set('status', 'pendente')
        newTask.set('priority', taskPriority)
        newTask.set('care_category', category)
        newTask.set('crm_contact_id', contactId)
        if (conversationId) newTask.set('conversation_id', conversationId)
        if (aiAction) newTask.set('description', aiAction)
        $app.saveNoValidate(newTask)
      } catch (createErr) {
        $app
          .logger()
          .error(
            'crm_care_reclassify_tasks: create failed',
            'contact',
            contactId,
            'error',
            String(createErr),
          )
      }
    }
  }

  return e.next()
}, 'crm_contacts')
