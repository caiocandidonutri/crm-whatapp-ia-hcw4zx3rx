migrate(
  (app) => {
    try {
      app
        .db()
        .newQuery(`
      DELETE FROM appointments
      WHERE source = 'agenda_externa'
        AND (
          external_id LIKE '%_'
          OR external_id LIKE '% %'
          OR starts_at = last_synced_at
        )
    `)
        .execute()
      console.log('[0107_cleanup_legacy_broken_appointments] Deleção concluída com sucesso.')
    } catch (err) {
      console.log(
        '[0107_cleanup_legacy_broken_appointments] Erro ao deletar agendamentos legados:',
        err,
      )
      throw err
    }
  },
  (app) => {
    // Rollback não aplicável para limpeza de dados legados corrompidos
  },
)
