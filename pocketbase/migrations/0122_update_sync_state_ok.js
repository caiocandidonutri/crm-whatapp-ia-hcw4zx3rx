/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0122: Atualização do sync_state para 'ok' e reset do last_error
 */
migrate(
  (app) => {
    try {
      var stateRec = app.findFirstRecordByFilter(
        'sync_state',
        'id = "xfyoa7n791cu701" || key = "agenda_externa_dr_caio"',
      )
      if (stateRec) {
        stateRec.set('last_status', 'ok')
        stateRec.set('last_sync', new Date().toISOString())
        stateRec.set('last_error', '')
        app.saveNoValidate(stateRec)
        app.logger().info('migration 0122: sync_state atualizado para ok com sucesso')
      }
    } catch (e) {
      try {
        app
          .db()
          .newQuery(
            "UPDATE sync_state SET last_status = 'ok', last_sync = {:now}, last_error = '' WHERE id = 'xfyoa7n791cu701' OR key = 'agenda_externa_dr_caio'",
          )
          .bind({ now: new Date().toISOString() })
          .execute()
      } catch (sqlErr) {
        app.logger().warn('migration 0122 warn: ' + String(sqlErr))
      }
    }
  },
  (app) => {},
)
