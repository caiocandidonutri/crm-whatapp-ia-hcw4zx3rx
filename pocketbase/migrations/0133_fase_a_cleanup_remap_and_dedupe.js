migrate(
  (app) => {
    // FASE A: Limpeza e Remapeamento
    // 1. Remapear crm_contacts com instance_name antiga ('instance_1785519369909' ou 'instance_1785377018448') para a instância real conectada: 'instance_1786021758855'
    // Verificar se a instância real conectada existe
    let realInst = null
    try {
      realInst = app.findFirstRecordByFilter(
        'whatsapp_instances',
        'status = "connected" || instance_name = "instance_1786021758855"',
      )
    } catch (_) {}

    const targetInstanceName = realInst
      ? realInst.getString('instance_name')
      : 'instance_1786021758855'

    try {
      // Remapear contatos que estão na instância antiga
      app
        .db()
        .newQuery(
          'UPDATE crm_contacts SET instance_name = {:realInst} WHERE instance_name = "instance_1785519369909" OR instance_name = "instance_1785377018448"',
        )
        .bind({ realInst: targetInstanceName })
        .execute()
    } catch (errRemapContacts) {
      console.log('[migration 0133] Erro ao remapear crm_contacts: ' + errRemapContacts)
    }

    // Remapear conversas antigas também para a instância conectada (se não conflitarem)
    try {
      // Apenas atualiza se não existir já uma conversa com o mesmo remote_jid na targetInstanceName
      app
        .db()
        .newQuery(
          'UPDATE conversations SET instance_name = {:realInst} WHERE (instance_name = "instance_1785519369909" OR instance_name = "instance_1785377018448") AND remote_jid NOT IN (SELECT remote_jid FROM conversations WHERE instance_name = {:realInst})',
        )
        .bind({ realInst: targetInstanceName })
        .execute()
    } catch (errRemapConvs) {
      console.log('[migration 0133] Erro ao remapear conversas: ' + errRemapConvs)
    }

    // 2. Preencher contact_phone e contact_name a partir do remote_jid e push_name onde estão vazios ou numéricos anômalos
    try {
      // Formatar telefone a partir de remote_jid tipo 55359... e preencher contact_phone
      app
        .db()
        .newQuery(
          "UPDATE conversations SET contact_phone = REPLACE(SUBSTR(remote_jid, 1, INSTR(remote_jid, '@') - 1), '55', '') WHERE (contact_phone = '' OR contact_phone IS NULL) AND remote_jid LIKE '%@s.whatsapp.net'",
        )
        .execute()
    } catch (errPhone) {
      console.log('[migration 0133] Erro ao preencher contact_phone conversations: ' + errPhone)
    }

    try {
      app
        .db()
        .newQuery(
          "UPDATE crm_contacts SET phone = REPLACE(SUBSTR(jid, 1, INSTR(jid, '@') - 1), '55', '') WHERE (phone = '' OR phone IS NULL) AND jid LIKE '%@s.whatsapp.net'",
        )
        .execute()
    } catch (errPhoneCrm) {
      console.log('[migration 0133] Erro ao preencher phone crm_contacts: ' + errPhoneCrm)
    }

    // 3. Fechar tarefas duplicadas abertas:
    // Se para o mesmo crm_contact_id e mesma care_category houver mais de 1 tarefa com status 'pendente' ou 'em_andamento', manter a mais recente e marcar as anteriores como 'concluida'
    try {
      app
        .db()
        .newQuery(
          "UPDATE tasks SET status = 'concluida', completed_at = DATETIME('now') WHERE id IN (" +
            "  SELECT t1.id FROM tasks t1 WHERE (t1.status = 'pendente' OR t1.status = 'em_andamento') " +
            "  AND t1.care_category != '' AND t1.care_category != 'sem_categoria' AND t1.crm_contact_id != '' " +
            '  AND EXISTS (' +
            '    SELECT 1 FROM tasks t2 WHERE t2.crm_contact_id = t1.crm_contact_id ' +
            '    AND t2.care_category = t1.care_category ' +
            "    AND (t2.status = 'pendente' OR t2.status = 'em_andamento') " +
            '    AND (t2.created > t1.created OR (t2.created = t1.created AND t2.id > t1.id))' +
            '  )' +
            ')',
        )
        .execute()
    } catch (errDedupeTasks) {
      console.log('[migration 0133] Erro ao deduplicar tarefas existentes: ' + errDedupeTasks)
    }

    // 4. Também deduplicar tarefas com títulos idênticos para o mesmo crm_contact_id
    try {
      app
        .db()
        .newQuery(
          "UPDATE tasks SET status = 'concluida', completed_at = DATETIME('now') WHERE id IN (" +
            "  SELECT t1.id FROM tasks t1 WHERE (t1.status = 'pendente' OR t1.status = 'em_andamento') " +
            "  AND t1.crm_contact_id != '' AND t1.title != '' " +
            '  AND EXISTS (' +
            '    SELECT 1 FROM tasks t2 WHERE t2.crm_contact_id = t1.crm_contact_id ' +
            '    AND t2.title = t1.title ' +
            "    AND (t2.status = 'pendente' OR t2.status = 'em_andamento') " +
            '    AND (t2.created > t1.created OR (t2.created = t1.created AND t2.id > t1.id))' +
            '  )' +
            ')',
        )
        .execute()
    } catch (errDedupeTitle) {
      console.log('[migration 0133] Erro ao deduplicar tarefas por título: ' + errDedupeTitle)
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
