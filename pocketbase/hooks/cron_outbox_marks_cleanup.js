// Cron diário: remove marcas de outbox_marks com mais de 7 dias.
// ÚNICA exclusão permitida no projeto — só nesta tabela, nunca em dados de pacientes.
// Minuto escalonado (00:07), sem envio de mensagens.

cronAdd('cron_outbox_marks_cleanup', '7 0 * * *', () => {
  const startTime = Date.now()
  const maxExecutionMs = 5000

  try {
    const cutoffIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    let removed = 0

    // Pagina em lotes para respeitar o orçamento de tempo
    while (Date.now() - startTime < maxExecutionMs) {
      let batch = []
      try {
        batch = $app.findRecordsByFilter('outbox_marks', 'created < {:cutoff}', 'created', 200, 0, {
          cutoff: cutoffIso,
        })
      } catch (findErr) {
        $app.logger().warn('cron_outbox_marks_cleanup: find failed', 'err', String(findErr))
        break
      }
      if (!batch || batch.length === 0) break
      for (let i = 0; i < batch.length; i++) {
        try {
          $app.delete(batch[i])
          removed++
        } catch (_) {}
      }
    }

    if (removed > 0) {
      $app
        .logger()
        .info(
          'cron_outbox_marks_cleanup: finished',
          'removed',
          removed,
          'durationMs',
          Date.now() - startTime,
        )
    }
  } catch (globalErr) {
    $app.logger().error('cron_outbox_marks_cleanup: fatal error', 'err', String(globalErr))
  }
})
