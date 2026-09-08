migrate(
  (app) => {
    // Limpeza de tarefas fantasma de JIDs inválidos (@lid, @g.us, status@broadcast ou >13 dígitos)
    // Cancela (status='cancelada') e adiciona marcação defensiva na descrição.
    try {
      // 1. Atualizar tarefas vinculadas a contatos com JID @lid, @g.us, broadcast ou números com mais de 13 dígitos
      app
        .db()
        .newQuery(`
      UPDATE tasks 
      SET status = 'cancelada', 
          description = '[Cancelada: JID inválido/dispositivo LID] ' || COALESCE(description, '')
      WHERE status != 'cancelada' AND crm_contact_id IN (
        SELECT id FROM crm_contacts 
        WHERE jid LIKE '%@lid' 
           OR jid LIKE '%@g.us' 
           OR jid = 'status@broadcast'
           OR LENGTH(SUBSTR(jid, 1, INSTR(jid, '@') - 1)) > 13
           OR LENGTH(SUBSTR(jid, 1, INSTR(jid, '@') - 1)) < 10
      )
    `)
        .execute()

      // 2. Cobrir também tarefas cujo próprio título ou descrição carreguem identificação de LID ou >13 dígitos
      app
        .db()
        .newQuery(`
      UPDATE tasks 
      SET status = 'cancelada', 
          description = '[Cancelada: JID inválido/dispositivo LID] ' || COALESCE(description, '')
      WHERE status != 'cancelada' 
        AND (title LIKE '%@lid%' OR title LIKE '%@g.us%' OR title LIKE '%broadcast%')
    `)
        .execute()
    } catch (err) {
      console.log('[0085_cleanup_invalid_jid_tasks] Erro na limpeza:', err)
    }
  },
  (app) => {
    // Rollback não aplicável para limpeza de dados inválidos
  },
)
