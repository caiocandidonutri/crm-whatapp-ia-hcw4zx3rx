// A cada 10 minutos, popula `last_message_timestamp` em conversations que ainda
// estão zeradas, lendo o MAX(timestamp) das whatsapp_messages associadas.
//
// Por que existe: a migration 0017 tentou fazer esse backfill mas pode ter
// falhado silenciosamente em algumas builds do PocketBase (filter vazio em
// findRecordsByFilter dá erro). A 0018 fez backup via SQL direto, mas se
// também não rodou, este cron resolve aos poucos sem mexer em dados já
// corretos.
//
// Processa até 20 conversations por execução para evitar travas longas no SQLite.
cronAdd('backfill_conv_timestamps', '*/10 * * * *', () => {
  let records = []
  try {
    // Busca até 20 conversas para conferir se há mensagens mais recentes
    // ordenando pelas mais antigas atualizadas (+updated) para rodar continuamente
    records = $app.findRecordsByFilter('conversations', 'remote_jid != ""', '+updated', 20, 0, {})
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
      if (!remoteJid) continue

      // Consulta o MAX(timestamp) de whatsapp_messages para esta conversa
      const maxRow = new DynamicModel({ max_ts: 0 })
      try {
        if (instanceName) {
          $app
            .db()
            .newQuery(
              'SELECT COALESCE(MAX(timestamp), 0) as max_ts FROM whatsapp_messages WHERE remote_jid = {:jid} AND instance_name = {:inst}',
            )
            .bind({ jid: remoteJid, inst: instanceName })
            .one(maxRow)
        } else {
          $app
            .db()
            .newQuery(
              'SELECT COALESCE(MAX(timestamp), 0) as max_ts FROM whatsapp_messages WHERE remote_jid = {:jid}',
            )
            .bind({ jid: remoteJid })
            .one(maxRow)
        }
      } catch (_) {
        continue
      }

      const maxTs = maxRow.max_ts || 0
      const currentTs = conv.getInt('last_message_timestamp') || 0

      // Atualiza quando o MAX das mensagens for maior que o gravado na conversa
      // (cobrindo conversas zeradas ou com datas desatualizadas/antigas de agosto)
      if (maxTs > currentTs) {
        conv.set('last_message_timestamp', maxTs)
        try {
          $app.saveNoValidate(conv)
          updatedCount++
        } catch (_) {}
      }
    } catch (_) {}
  }

  if (updatedCount > 0) {
    $app
      .logger()
      .info('backfill_conv_timestamps_done', 'updated', updatedCount, 'batch_size', records.length)
  }
})
