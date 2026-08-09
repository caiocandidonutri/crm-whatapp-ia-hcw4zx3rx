cronAdd('post_consultation_followup', '0 9 * * *', () => {
  var nowTs = Math.floor(Date.now() / 1000)
  var todayStr = new Date().toISOString().split('T')[0]
  var tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0]

  var patients = []
  try {
    patients = $app.findRecordsByFilter('crm_contacts', 'is_patient = true', '-updated', 200, 0)
  } catch (err) {
    $app.logger().error('cron_followup: query patients failed', 'error', String(err))
    return
  }

  if (!patients || patients.length === 0) return

  var updatedCount = 0

  for (var p = 0; p < patients.length; p++) {
    try {
      var patient = patients[p]
      var careStatus = 'em_dia'
      var convertedAt = patient.getString('converted_at')

      if (convertedAt) {
        var convertedTs = Math.floor(new Date(convertedAt).getTime() / 1000)
        var daysSinceConsultation = Math.floor((nowTs - convertedTs) / 86400)
        if (daysSinceConsultation >= 10) {
          careStatus = 'precisa_retorno'
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

  var followupContacts = []
  try {
    followupContacts = $app.findRecordsByFilter(
      'crm_contacts',
      'is_patient = true && converted_at = {:date}',
      '-created',
      50,
      0,
      { date: tenDaysAgo },
    )
  } catch (err) {
    $app.logger().error('cron_followup: query followup contacts failed', 'error', String(err))
    followupContacts = []
  }

  var tasksCreated = 0

  for (var i = 0; i < followupContacts.length; i++) {
    var contact = followupContacts[i]
    var contactId = contact.id
    var userId = contact.getString('user_id')
    var accountId = contact.getString('account_id')
    var contactName =
      contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'

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
      ' que teve consulta há 10 dias (em ' +
      tenDaysAgo +
      '). A mensagem deve ser acolhedora, natural e curta (max 200 chars).'

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
        .error('cron_followup: agent chat failed', 'contact', contactId, 'error', String(agentErr))
      followupText = 'Olá! Como você está se sentindo após a consulta? Estamos à disposição! 🙏'
    }

    if (!followupText)
      followupText = 'Olá! Como você está se sentindo após a consulta? Estamos à disposição! 🙏'

    try {
      var taskCol = $app.findCollectionByNameOrId('tasks')
      var task = new Record(taskCol)
      task.set('user_id', userId)
      if (accountId) task.set('account_id', accountId)
      task.set('title', 'Follow-up: ' + contactName)
      task.set('description', followupText)
      task.set('status', 'pendente')
      task.set('priority', 'media')
      task.set('crm_contact_id', contactId)
      task.set('due_date', todayStr)
      $app.save(task)
      tasksCreated++

      contact.set('ai_suggested_action', 'Follow-up: ' + followupText.substring(0, 120))
      contact.set('care_status', 'precisa_retorno')
      $app.saveNoValidate(contact)
    } catch (taskErr) {
      $app
        .logger()
        .error('cron_followup: create task failed', 'contact', contactId, 'error', String(taskErr))
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
})
