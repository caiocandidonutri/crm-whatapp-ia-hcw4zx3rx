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
      const authId = e.auth && e.auth.id
      if (!authId) {
        return e.json(401, { success: false, error: 'unauthorized' })
      }

      // Descobre accountId do usuário via account_members
      let accountId = ''
      try {
        const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: authId,
        })
        if (member) {
          accountId = member.getString('account_id') || ''
        }
      } catch (_) {}

      // Conta quantas convs estão pendentes ANTES de atualizar
      let pendingBefore = 0
      try {
        const row = new DynamicModel({ c: 0 })
        if (accountId) {
          $app
            .db()
            .newQuery(
              `SELECT COUNT(*) as c FROM conversations
               WHERE (account_id = {:accId} OR user_id = {:userId})
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ accId: accountId, userId: authId })
            .one(row)
        } else {
          $app
            .db()
            .newQuery(
              `SELECT COUNT(*) as c FROM conversations
               WHERE user_id = {:userId}
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ userId: authId })
            .one(row)
        }
        pendingBefore = row.c || 0
      } catch (cntErr) {
        $app.logger().warn('backfill_timestamps_count_before_failed', 'error', String(cntErr))
      }

      // SQL direto: para cada conversation pendente, popula com MAX(timestamp)
      // das whatsapp_messages correspondentes no escopo da conta ou usuário.
      // Manutenção 100% LOCAL do banco SQLite — zero chamadas a serviços externos.
      try {
        if (accountId) {
          $app
            .db()
            .newQuery(
              `UPDATE conversations
               SET last_message_timestamp = COALESCE(
                 (
                   SELECT MAX(m.timestamp)
                   FROM whatsapp_messages m
                   WHERE m.remote_jid = conversations.remote_jid
                     AND (m.instance_name = conversations.instance_name OR conversations.instance_name = '' OR conversations.instance_name IS NULL)
                     AND (m.account_id = {:accId} OR m.user_id = {:userId})
                 ),
                 0
               )
               WHERE (account_id = {:accId} OR user_id = {:userId})
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ accId: accountId, userId: authId })
            .execute()
        } else {
          $app
            .db()
            .newQuery(
              `UPDATE conversations
               SET last_message_timestamp = COALESCE(
                 (
                   SELECT MAX(m.timestamp)
                   FROM whatsapp_messages m
                   WHERE m.remote_jid = conversations.remote_jid
                     AND (m.instance_name = conversations.instance_name OR conversations.instance_name = '' OR conversations.instance_name IS NULL)
                     AND m.user_id = {:userId}
                 ),
                 0
               )
               WHERE user_id = {:userId}
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ userId: authId })
            .execute()
        }
      } catch (sqlErr) {
        $app.logger().error('backfill_timestamps_sql_error', 'error', String(sqlErr))
        return e.json(500, { success: false, error: 'sql_failed', message: String(sqlErr) })
      }

      // Conta quantas convs ainda estão pendentes DEPOIS
      let pendingAfter = 0
      try {
        const row = new DynamicModel({ c: 0 })
        if (accountId) {
          $app
            .db()
            .newQuery(
              `SELECT COUNT(*) as c FROM conversations
               WHERE (account_id = {:accId} OR user_id = {:userId})
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ accId: accountId, userId: authId })
            .one(row)
        } else {
          $app
            .db()
            .newQuery(
              `SELECT COUNT(*) as c FROM conversations
               WHERE user_id = {:userId}
                 AND (last_message_timestamp IS NULL OR last_message_timestamp = 0)`,
            )
            .bind({ userId: authId })
            .one(row)
        }
        pendingAfter = row.c || 0
      } catch (cntAfterErr) {
        $app.logger().warn('backfill_timestamps_count_after_failed', 'error', String(cntAfterErr))
      }

      const updated = Math.max(0, pendingBefore - pendingAfter)

      $app
        .logger()
        .info(
          'backfill_timestamps_done',
          'userId',
          authId,
          'accountId',
          accountId,
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
      return e.json(500, { success: false, error: 'internal_error', message: String(err) })
    }
  },
  $apis.requireAuth(),
)
