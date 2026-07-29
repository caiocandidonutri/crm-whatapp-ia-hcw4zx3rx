// Endpoint manual para forçar o backfill de `last_message_timestamp` em
// todas as conversations do user logado. Usa SQL direto (mais robusto que
// findRecordsByFilter com `= 0`, que ignora NULLs em algumas builds).
//
// O cron `backfill_conv_timestamps` deveria fazer isso aos poucos, mas em
// algumas builds do PocketBase o filter `last_message_timestamp = 0` não
// retorna registros com valor NULL — daí a 0017/0018/cron não populam nada
// e a lista de conversas fica ordenada pelo upload time pra sempre.
//
// Este endpoint é chamado automaticamente pelo front (useConversas) quando
// detectamos convs sem timestamp real, mas também pode ser invocado
// manualmente em caso de necessidade.
routerAdd(
  'POST',
  '/backend/v1/whatsapp/backfill-timestamps',
  (e) => {
    try {
      const authId = e.auth.id
      if (!authId) {
        return e.json(401, { success: false, error: 'unauthorized' })
      }

      // Conta quantas convs estão pendentes ANTES de atualizar
      let pendingBefore = 0
      try {
        const row = $app
          .db()
          .newQuery(
            `SELECT COUNT(*) as c FROM conversations
             WHERE user_id = {:userId}
               AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
          )
          .bind({ userId: authId })
          .one()
        pendingBefore = (row && row.c) || 0
      } catch (_) {}

      // SQL direto: para cada conversation do user com ts zerado/null,
      // popula com MAX(timestamp) das mensagens correspondentes.
      try {
        $app
          .db()
          .newQuery(
            `UPDATE conversations
             SET last_message_timestamp = COALESCE(
               (
                 SELECT MAX(m.timestamp)
                 FROM whatsapp_messages m
                 WHERE m.remote_jid = conversations.remote_jid
                   AND m.instance_name = conversations.instance_name
                   AND m.user_id = conversations.user_id
               ),
               0
             )
             WHERE user_id = {:userId}
               AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
          )
          .bind({ userId: authId })
          .execute()
      } catch (sqlErr) {
        $app.logger().error('backfill_timestamps_sql_error', 'error', String(sqlErr))
        return e.json(500, { success: false, error: 'sql_failed' })
      }

      // Conta quantas convs ainda estão pendentes DEPOIS (= sem mensagens
      // associadas, ou com timestamp 0 nas msgs)
      let pendingAfter = 0
      try {
        const row = $app
          .db()
          .newQuery(
            `SELECT COUNT(*) as c FROM conversations
             WHERE user_id = {:userId}
               AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
          )
          .bind({ userId: authId })
          .one()
        pendingAfter = (row && row.c) || 0
      } catch (_) {}

      const updated = pendingBefore - pendingAfter

      $app
        .logger()
        .info(
          'backfill_timestamps_done',
          'userId',
          authId,
          'updated',
          updated,
          'pending_before',
          pendingBefore,
          'pending_after',
          pendingAfter,
        )

      return e.json(200, {
        success: true,
        updated: updated,
        pending_before: pendingBefore,
        pending_after: pendingAfter,
      })
    } catch (err) {
      $app.logger().error('backfill_timestamps_fatal', 'error', String(err))
      return e.json(500, { success: false, error: 'internal_error' })
    }
  },
  $apis.requireAuth(),
)
