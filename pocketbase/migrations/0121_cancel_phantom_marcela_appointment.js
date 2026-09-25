/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0121: Correção do agendamento fantasma de Marcela Cirilo Rocha
 *
 * Atualiza o agendamento fantasma k1t0678wzznndus (starts_at: 2026-09-25 19:00:00.000Z)
 * para status = 'cancelado' e adiciona a nota explicativa.
 * Mantém intacto o agendamento histórico l4srrnptpazkegq (07/08/2026).
 * Silmara Lailah Correa (6a7bu3smxmvxnaa) e Danila de Oliveira Corrêa (akvf1nu34x2i5lk)
 * continuam confirmadas em 25/09.
 */
migrate(
  (app) => {
    try {
      var record = app.findRecordById('appointments', 'k1t0678wzznndus')
      if (record) {
        record.set('status', 'cancelado')
        record.set('notes', 'Agendamento removido da agenda oficial ClinicaPro em 25/09')
        record.set('last_synced_at', new Date().toISOString())
        app.saveNoValidate(record)
        app
          .logger()
          .info('migration 0121: Marcela Cirilo Rocha (k1t0678wzznndus) cancelada com sucesso')
      }
    } catch (e) {
      // Tentar via SQL direto caso findRecordById falhe
      try {
        app
          .db()
          .newQuery(
            "UPDATE appointments SET status = 'cancelado', notes = 'Agendamento removido da agenda oficial ClinicaPro em 25/09', last_synced_at = {:now} WHERE id = 'k1t0678wzznndus'",
          )
          .bind({ now: new Date().toISOString() })
          .execute()
      } catch (sqlErr) {
        app.logger().warn('migration 0121 warn: ' + String(sqlErr))
      }
    }
  },
  (app) => {
    try {
      var record = app.findRecordById('appointments', 'k1t0678wzznndus')
      if (record) {
        record.set('status', 'confirmado')
        app.saveNoValidate(record)
      }
    } catch (_) {}
  },
)
