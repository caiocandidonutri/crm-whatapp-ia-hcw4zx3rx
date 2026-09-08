migrate(
  (app) => {
    const nowIso = new Date().toISOString()
    const nowTs = Math.floor(Date.now() / 1000)
    const nextDayIso = new Date(Date.now() + 86400000).toISOString()

    // 1. Preencher due_date vazio ou não-ISO nas tarefas pendentes/em_andamento
    // Garante que todas as tarefas ativas tenham due_date em formato ISO completo (ex: 2026-09-09T00:00:00.000Z)
    try {
      const tasksWithoutDueDate = app.findRecordsByFilter(
        'tasks',
        "(due_date = '' || due_date = null) && (status = 'pendente' || status = 'em_andamento')",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < tasksWithoutDueDate.length; i++) {
        const t = tasksWithoutDueDate[i]
        t.set('due_date', nextDayIso)
        app.saveNoValidate(t)
      }
    } catch (e1) {
      console.log('Migration 0082: Error fixing empty due_dates:', e1)
    }

    // 2. Normalizar due_dates que foram gravados como YYYY-MM-DD para ISO completo
    try {
      const activeTasks = app.findRecordsByFilter(
        'tasks',
        "due_date != '' && (status = 'pendente' || status = 'em_andamento')",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < activeTasks.length; i++) {
        const t = activeTasks[i]
        const d = t.getString('due_date')
        if (d && d.indexOf('T') === -1) {
          // Formato como '2026-09-09' ou '2026-09-09 12:00:00'
          const parsed = new Date(d.replace(' ', 'T'))
          if (!isNaN(parsed.getTime())) {
            t.set('due_date', parsed.toISOString())
            app.saveNoValidate(t)
          }
        }
      }
    } catch (e2) {
      console.log('Migration 0082: Error normalizing due_dates to full ISO:', e2)
    }

    // 3. Concluir tarefas de "não respondeu" cujo paciente já respondeu
    // Se a última mensagem for do paciente (from_me = false) ou tiver menos de 8 horas desde a do atendente
    try {
      const pendingNR = app.findRecordsByFilter(
        'tasks',
        "care_category = 'nao_respondeu' && (status = 'pendente' || status = 'em_andamento')",
        '-created',
        2000,
        0,
      )

      for (let i = 0; i < pendingNR.length; i++) {
        const task = pendingNR[i]
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
            30,
            0,
            { jid: jid, inst: instanceName },
          )
        } catch (_) {}

        if (!messages || messages.length === 0) continue

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

        // Se o paciente respondeu depois do atendente ou o tempo é inferior a 8h, conclui a tarefa
        const shouldBeNaoRespondeu =
          lastFromMeTs > 0 && lastPatientTs <= lastFromMeTs && nowTs - lastFromMeTs >= 8 * 3600

        if (!shouldBeNaoRespondeu) {
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          app.saveNoValidate(task)

          // Reverter estágio do contato caso esteja preso em nao_respondido
          if (contact.getString('stage') === 'nao_respondido') {
            contact.set('stage', 'em_atendimento')
          }
          if (contact.getString('care_status') === 'nao_respondeu') {
            contact.set('care_status', 'em_dia')
          }
          try {
            app.saveNoValidate(contact)
          } catch (_) {}
        }
      }
    } catch (e3) {
      console.log('Migration 0082: Error resolving answered nao_respondeu tasks:', e3)
    }

    // 4. Concluir tarefas duplicadas ativas (mantém apenas 1 ativa por contato + categoria)
    try {
      const activeCareTasks = app.findRecordsByFilter(
        'tasks',
        "care_category != '' && care_category != 'sem_categoria' && (status = 'pendente' || status = 'em_andamento')",
        '-created',
        10000,
        0,
      )

      const seenActive = {}
      for (let i = 0; i < activeCareTasks.length; i++) {
        const task = activeCareTasks[i]
        const cId = task.getString('crm_contact_id') || ''
        const cat = task.getString('care_category') || ''
        const title = task.getString('title') || ''

        const key = cId ? cId + '::' + cat : title + '::' + cat

        if (seenActive[key]) {
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          app.saveNoValidate(task)
        } else {
          seenActive[key] = true
        }
      }
    } catch (e4) {
      console.log('Migration 0082: Error deduplicating active care tasks:', e4)
    }
  },
  (app) => {
    // down: no-op
  },
)
