// A cada minuto, popula `last_message_timestamp` em conversations que ainda
// estão zeradas, lendo o MAX(timestamp) das whatsapp_messages associadas.
//
// Por que existe: a migration 0017 tentou fazer esse backfill mas pode ter
// falhado silenciosamente em algumas builds do PocketBase (filter vazio em
// findRecordsByFilter dá erro). A 0018 fez backup via SQL direto, mas se
// também não rodou, este cron resolve aos poucos sem mexer em dados já
// corretos.
//
// Processa até 200 conversations por execução. Para uma conta normal,
// finaliza em 1 ou 2 minutos. Após populadas, o WHERE não retorna nada
// e o cron vira no-op.
cronAdd('backfill_conv_timestamps', '* * * * *', () => {
  let records = []
  try {
    // Pega tanto valores 0 (default do NumberField) quanto null (rows
    // antigas, anteriores à migration 0017, em que o campo pode ter ficado
    // sem default). Sem o `= null`, conversas pré-migração jamais entravam
    // no backfill.
    records = $app.findRecordsByFilter(
      'conversations',
      'last_message_timestamp = 0 || last_message_timestamp = null',
      '+created',
      200,
      0,
      {},
    )
  } catch (err) {
    $app.logger().error('cron_backfill_conv_timestamps_query_error', 'error', String(err))
    return
  }

  if (!records || records.length === 0) return

  let updatedCount = 0

  for (const conv of records) {
    try {
      const remoteJid = conv.getString('remote_jid')
      const instanceName = conv.getString('instance_name')
      if (!remoteJid || !instanceName) continue

      let lastMsgs = []
      try {
        lastMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:name}',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, name: instanceName },
        )
      } catch (_) {
        continue
      }

      if (lastMsgs && lastMsgs.length > 0) {
        const ts = lastMsgs[0].getInt('timestamp') || 0
        if (ts > 0) {
          conv.set('last_message_timestamp', ts)
          try {
            $app.save(conv)
            updatedCount++
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  if (updatedCount > 0) {
    $app
      .logger()
      .info('backfill_conv_timestamps_done', 'updated', updatedCount, 'batch_size', records.length)
  }
})
