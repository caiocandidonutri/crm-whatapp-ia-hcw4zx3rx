migrate(
  (app) => {
    const nowIso = new Date().toISOString()
    const nowMs = Date.now()

    // Função auxiliar para registrar snapshot em baseline_snapshots
    function recordSnapshot(accountId, collectionName, recordId, field, oldValue) {
      try {
        const snapCol = app.findCollectionByNameOrId('baseline_snapshots')
        const snap = new Record(snapCol)
        snap.set('account_id', accountId || '')
        snap.set('collection_name', collectionName)
        snap.set('record_id', recordId)
        snap.set('field', field)
        snap.set('old_value', oldValue !== null && oldValue !== undefined ? String(oldValue) : '')
        snap.set('reason', 'limpeza-fantasmas')
        app.saveNoValidate(snap)
      } catch (err) {
        // Ignora silenciosamente para não abortar
      }
    }

    // 1. SINCRONIZAÇÃO LEGADA:
    // Em todos os contatos com care_state 'retorno_a_oferecer' que possuem care_status velho 'precisa_retorno'
    // Atualizar care_status para 'em_dia' gravando snapshot prévio
    const contactsToSync = app.findRecordsByFilter(
      'crm_contacts',
      "care_status = 'precisa_retorno' && care_state = 'retorno_a_oferecer'",
      '-created',
      5000,
      0,
    )

    for (let i = 0; i < contactsToSync.length; i++) {
      const c = contactsToSync[i]
      const oldStatus = c.getString('care_status')
      recordSnapshot(c.getString('account_id'), 'crm_contacts', c.id, 'care_status', oldStatus)
      c.set('care_status', 'em_dia')
      try {
        app.saveNoValidate(c)
      } catch (saveErr) {}
    }

    // 2. LIMPEZA DE TAREFAS FANTASMA:
    // Tarefas pendentes com vencimento no passado OU criadas antes de mensagem humana posterior do contato
    // -> status "resolvida_auto" com motivo e hora no próprio registro (NUNCA "concluída")
    // Gravar snapshot em baseline_snapshots (motivo "limpeza-fantasmas") ANTES de mudar qualquer status.
    const openTasks = app.findRecordsByFilter(
      'tasks',
      "status = 'pendente' || status = 'em_andamento'",
      '-created',
      10000,
      0,
    )

    // Mapa de contatos em cache para buscar last_human_contact_at
    const contactsCache = {}

    for (let t = 0; t < openTasks.length; t++) {
      const task = openTasks[t]
      const dueStr = task.getString('due_date')
      const dueMs = dueStr ? Date.parse(dueStr) : 0
      const createdStr = task.getString('created')
      const createdMs = createdStr ? Date.parse(createdStr) : 0
      const contactId = task.getString('crm_contact_id')

      let isOverduePast = dueMs > 0 && dueMs < nowMs - 60000
      let hasHumanMsgAfter = false

      if (contactId) {
        if (!contactsCache[contactId]) {
          try {
            contactsCache[contactId] = app.findRecordById('crm_contacts', contactId)
          } catch (_) {
            contactsCache[contactId] = null
          }
        }

        const contact = contactsCache[contactId]
        if (contact) {
          const lastHumanStr = contact.getString('last_human_contact_at')
          if (lastHumanStr) {
            const lastHumanMs = Date.parse(lastHumanStr)
            if (!isNaN(lastHumanMs) && lastHumanMs > createdMs) {
              hasHumanMsgAfter = true
            }
          }
        }
      }

      // Se venceu no passado OU foi criada antes de mensagem humana posterior
      if (isOverduePast || hasHumanMsgAfter) {
        const oldStatus = task.getString('status')
        recordSnapshot(task.getString('account_id'), 'tasks', task.id, 'status', oldStatus)

        task.set('status', 'resolvida_auto')
        const currentDesc = task.getString('description') || ''
        const reasonDetail = isOverduePast
          ? 'vencimento no passado (' + (dueStr || '') + ')'
          : 'mensagem humana posterior do contato'
        const reasonTag = '[resolvida_auto: ' + reasonDetail + ' às ' + nowIso + ']'
        task.set('description', currentDesc ? currentDesc + '\n' + reasonTag : reasonTag)
        task.set('completed_at', nowIso)

        try {
          app.saveNoValidate(task)
        } catch (taskSaveErr) {}
      }
    }
  },
  (app) => {
    // Down migration: reversão segura é feita pelo baseline_snapshots se necessário
  },
)
