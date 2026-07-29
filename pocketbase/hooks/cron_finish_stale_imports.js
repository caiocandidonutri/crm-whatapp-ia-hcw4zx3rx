// A cada minuto, verifica imports presos: se a instância está com
// is_importing_history=true mas não recebe novos batches há mais de 3 minutos
// (`updated < now - 3min`), assume que a Baileys terminou e marca como
// concluído. Isso evita banner de progresso ficar eterno se o Baileys
// não enviar isLatest=true (acontece em algumas versões do Evolution).
cronAdd('finish_stale_imports', '* * * * *', () => {
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString().replace('T', ' ')

  let records = []
  try {
    records = $app.findRecordsByFilter(
      'whatsapp_instances',
      'is_importing_history = true && updated < {:cutoff}',
      '-updated',
      50,
      0,
      { cutoff: cutoff },
    )
  } catch (err) {
    $app.logger().error('cron_finish_stale_imports_query_error', 'error', String(err))
    return
  }

  if (!records || records.length === 0) return

  for (const record of records) {
    try {
      record.set('is_importing_history', false)
      if (!record.getString('import_finished_at')) {
        record.set('import_finished_at', new Date().toISOString().replace('T', ' '))
      }
      $app.save(record)
      $app
        .logger()
        .info(
          'history_import_timeout_finished',
          'instance',
          record.getString('instance_name'),
          'count',
          record.getInt('import_messages_count') || 0,
        )
    } catch (err) {
      $app.logger().warn('cron_finish_stale_imports_save_error', 'error', String(err))
    }
  }
})
