migrate(
  (app) => {
    const nowTs = Math.floor(Date.now() / 1000)
    const nowIso = new Date().toISOString()

    // 1. Concluir tarefas 'nao_respondeu' pendentes onde o paciente já respondeu
    // ou onde a regra de 8h não se aplica.
    try {
      const pendingTasks = app.findRecordsByFilter(
        'tasks',
        "care_category = 'nao_respondeu' && status != 'concluida' && status != 'cancelada'",
        '-created',
        2000,
        0,
      )

      for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i]
        const contactId = task.getString('crm_contact_id')
        if (!contactId) continue

        let contact = null
        try {
          contact = app.findRecordById('crm_contacts', contactId)
        } catch (_) {
          continue
        }

        const jid = contact.getString('jid')
        const instanceName = contact.getString('instance_name')
        if (!jid || !instanceName) continue

        let messages = []
        try {
          messages = app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst}',
            '-timestamp',
            50,
            0,
            { jid: jid, inst: instanceName },
          )
        } catch (_) {}

        let lastFromMeTs = 0
        let lastPatientTs = 0
        for (let m = 0; m < messages.length; m++) {
          const msg = messages[m]
          const ts = msg.getInt('timestamp') || 0
          if (msg.getBool('from_me')) {
            if (ts > lastFromMeTs) lastFromMeTs = ts
          } else {
            if (ts > lastPatientTs) lastPatientTs = ts
          }
        }

        // Se o paciente enviou mensagem DEPOIS do atendente OU o atendente nunca mandou msg OU menos de 8h
        const shouldBeNaoRespondeu =
          lastFromMeTs > 0 && lastPatientTs <= lastFromMeTs && nowTs - lastFromMeTs >= 8 * 3600

        if (!shouldBeNaoRespondeu) {
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          app.save(task)
        }
      }
    } catch (err) {
      console.log('Migration 0078 error cleaning tasks:', err)
    }

    // 2. Deduplicar tarefas pendentes por contato e care_category
    // Mantém apenas a mais recente por (crm_contact_id, care_category) e conclui as outras
    try {
      const allPendingCareTasks = app.findRecordsByFilter(
        'tasks',
        "care_category != '' && care_category != 'sem_categoria' && status != 'concluida' && status != 'cancelada'",
        '-created',
        2000,
        0,
      )

      const seen = {}
      for (let j = 0; j < allPendingCareTasks.length; j++) {
        const t = allPendingCareTasks[j]
        const key = t.getString('crm_contact_id') + '::' + t.getString('care_category')
        if (seen[key]) {
          // Duplicata mais antiga encontrada -> conclui
          t.set('status', 'concluida')
          t.set('completed_at', nowIso)
          app.save(t)
        } else {
          seen[key] = true
        }
      }
    } catch (err2) {
      console.log('Migration 0078 error deduplicating tasks:', err2)
    }
  },
  (app) => {
    // down: no-op (tarefas já foram limpas/concluídas)
  },
)
