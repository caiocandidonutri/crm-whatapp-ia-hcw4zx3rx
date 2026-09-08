migrate(
  (app) => {
    const nowIso = new Date().toISOString()
    const nowTs = Math.floor(Date.now() / 1000)
    const nextDayDate = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    // 1. Marcar a instância legada 'instance_1785519369909' (e qualquer outra não-ativa com status connected/qrcode)
    // como inativa/desconectada, SEM TOCAR na instância ativa 'instance_1786021758855'.
    try {
      app
        .db()
        .newQuery(
          "UPDATE whatsapp_instances SET status = 'disconnected' WHERE instance_name = 'instance_1785519369909'",
        )
        .execute()
    } catch (e1) {
      console.log('Migration 0080: Error updating legacy instance status:', e1)
    }

    // 2. Mapear contatos e conversas da instância ativa 'instance_1786021758855'
    // chave: remote_jid / jid (ou telefone) -> id do crm_contact ativo e conversation_id ativa
    const activeContactsByJid = {}
    const activeConvsByJid = {}

    try {
      const activeContacts = app.findRecordsByFilter(
        'crm_contacts',
        "instance_name = 'instance_1786021758855'",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < activeContacts.length; i++) {
        const c = activeContacts[i]
        const j = c.getString('jid')
        if (j) activeContactsByJid[j] = c
        const p = c.getString('phone')
        if (p) activeContactsByJid[p] = c
      }
    } catch (e2) {
      console.log('Migration 0080: Error fetching active contacts:', e2)
    }

    try {
      const activeConvs = app.findRecordsByFilter(
        'conversations',
        "instance_name = 'instance_1786021758855'",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < activeConvs.length; i++) {
        const cv = activeConvs[i]
        const rj = cv.getString('remote_jid')
        if (rj) activeConvsByJid[rj] = cv
      }
    } catch (e3) {
      console.log('Migration 0080: Error fetching active conversations:', e3)
    }

    // 3. Arquivar conversas órfãs da instância legada que tenham correspondente na instância ativa
    try {
      const legacyConvs = app.findRecordsByFilter(
        'conversations',
        "instance_name = 'instance_1785519369909'",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < legacyConvs.length; i++) {
        const lc = legacyConvs[i]
        const rj = lc.getString('remote_jid')
        if (rj && activeConvsByJid[rj]) {
          // Já existe conversa na instância ativa: arquiva a órfã legada
          lc.set('archived', true)
          app.saveNoValidate(lc)
        }
      }
    } catch (e4) {
      console.log('Migration 0080: Error archiving legacy conversations:', e4)
    }

    // 4. Remapear tarefas que apontam para contatos/conversas da instância legada
    // Se o contato legado tiver equivalente na instância ativa, aponta a tarefa para ele!
    // Se não tiver correspondente ativo, conclui a tarefa para não poluir o Kanban.
    try {
      const allTasks = app.findRecordsByFilter(
        'tasks',
        "care_category != '' && care_category != 'sem_categoria'",
        '-created',
        10000,
        0,
      )

      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i]
        let cId = t.getString('crm_contact_id')
        let cvId = t.getString('conversation_id')
        let isLegacy = false
        let contactJid = ''

        if (cId) {
          try {
            const ct = app.findRecordById('crm_contacts', cId)
            if (ct.getString('instance_name') === 'instance_1785519369909') {
              isLegacy = true
              contactJid = ct.getString('jid') || ct.getString('phone')
            }
          } catch (_) {}
        }

        if (!isLegacy && cvId) {
          try {
            const cv = app.findRecordById('conversations', cvId)
            if (cv.getString('instance_name') === 'instance_1785519369909') {
              isLegacy = true
              if (!contactJid) contactJid = cv.getString('remote_jid')
            }
          } catch (_) {}
        }

        if (isLegacy) {
          const correspondingContact = activeContactsByJid[contactJid]
          const correspondingConv = activeConvsByJid[contactJid]

          if (correspondingContact) {
            t.set('crm_contact_id', correspondingContact.id)
            if (correspondingConv) {
              t.set('conversation_id', correspondingConv.id)
            }
            // Se o contato ativo tiver nome real (ex: Luana), atualiza o título da tarefa se for cru
            const realName =
              correspondingContact.getString('contact_name') ||
              correspondingContact.getString('push_name')
            if (realName && realName !== '.' && !/^[.\-_*#@!?,:;~^`'"]+$/.test(realName)) {
              const cat = t.getString('care_category')
              const prefixMap = {
                nao_respondeu: 'Não respondeu: ',
                precisa_retorno: 'Precisa retorno: ',
                precisa_consulta: 'Precisa consulta: ',
                precisa_atencao: 'Precisa atenção: ',
                followup_10_15: 'Follow-up 10-15 dias: ',
                alta_demanda: 'Alta demanda: ',
              }
              const prefix = prefixMap[cat] || 'Cuidado: '
              t.set('title', prefix + realName)
            }
            app.saveNoValidate(t)
          } else {
            // Não há correspondente ativo: conclui a tarefa órfã
            t.set('status', 'concluida')
            t.set('completed_at', nowIso)
            app.saveNoValidate(t)
          }
        }
      }
    } catch (e5) {
      console.log('Migration 0080: Error remapping tasks:', e5)
    }

    // 5. Preencher due_date automático nas tarefas de cuidado pendentes/em_andamento que estão sem due_date
    try {
      const careTasksWithoutDueDate = app.findRecordsByFilter(
        'tasks',
        "care_category != '' && care_category != 'sem_categoria' && due_date = '' && (status = 'pendente' || status = 'em_andamento')",
        '-created',
        5000,
        0,
      )
      for (let i = 0; i < careTasksWithoutDueDate.length; i++) {
        const task = careTasksWithoutDueDate[i]
        task.set('due_date', nextDayDate)
        const contactId = task.getString('crm_contact_id')
        if (contactId && !task.getString('assigned_to')) {
          try {
            const ct = app.findRecordById('crm_contacts', contactId)
            const asTo = ct.getString('assigned_to')
            if (asTo) task.set('assigned_to', asTo)
          } catch (_) {}
        }
        app.saveNoValidate(task)
      }
    } catch (e6) {
      console.log('Migration 0080: Error setting due_date on care tasks:', e6)
    }

    // 6. Limpeza retroativa: Concluir tarefas duplicadas ativas
    // Mantém APENAS 1 tarefa ativa por (crm_contact_id, care_category) ou (title, care_category) — a mais recente.
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

        // Chave de unicidade: contato + categoria (ou título se contato vazio)
        const key = cId ? cId + '::' + cat : title + '::' + cat

        if (seenActive[key]) {
          // Já existe uma tarefa ativa mais recente para este contato e categoria:
          // Marca esta duplicata mais antiga como concluída
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          app.saveNoValidate(task)
        } else {
          seenActive[key] = true
        }
      }
    } catch (e7) {
      console.log('Migration 0080: Error deduplicating active care tasks:', e7)
    }

    // 7. Concluir tarefas "nao_respondeu" onde o paciente já respondeu
    // (Última mensagem foi do paciente ou atendente falou depois)
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

        const shouldBeNaoRespondeu =
          lastFromMeTs > 0 && lastPatientTs <= lastFromMeTs && nowTs - lastFromMeTs >= 8 * 3600

        if (!shouldBeNaoRespondeu) {
          task.set('status', 'concluida')
          task.set('completed_at', nowIso)
          app.saveNoValidate(task)
        }
      }
    } catch (e8) {
      console.log('Migration 0080: Error finalizing responded tasks:', e8)
    }

    // 8. Limpar nomes com "." ou inválidos em crm_contacts e conversations
    try {
      app
        .db()
        .newQuery(
          "UPDATE crm_contacts SET contact_name = '' WHERE contact_name = '.' OR contact_name = '..'",
        )
        .execute()
      app
        .db()
        .newQuery(
          "UPDATE conversations SET contact_name = '' WHERE contact_name = '.' OR contact_name = '..'",
        )
        .execute()
    } catch (e9) {
      console.log('Migration 0080: Error cleaning invalid names:', e9)
    }
  },
  (app) => {
    // down: no-op
  },
)
