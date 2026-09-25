/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Restauração urgente de cancelamento indevido em massa pelo sync ocorrido às 14:23:01 de 25/09
    // O soft-cancel varreu de forma cega até +60d e cancelou registros futuros (27/10 a 18/11/2026).
    // Marcela Cirilo Rocha (k1t0678wzznndus) teve cancelamento legítimo e NÃO deve ser restaurada.

    try {
      var records = app.findRecordsByFilter(
        'appointments',
        'status = "cancelado" && notes ~ "Cancelado/removido na agenda oficial" && starts_at >= "2026-10-25 00:00:00.000Z" && starts_at <= "2026-11-20 23:59:59.999Z" && id != "k1t0678wzznndus"',
        'starts_at',
        100,
        0,
      )

      app
        .logger()
        .info('migration 0123: agendamentos encontrados para restauracao: ' + records.length)

      for (var i = 0; i < records.length; i++) {
        var r = records[i]
        var newStatus = 'agendado'
        var lastType = r.getString('last_interaction_type')
        var confSent = r.getString('confirmation_sent_at')
        var remSent = r.getString('reminder_day_sent_at')

        if (
          (lastType && lastType.indexOf('confirmado') !== -1) ||
          (confSent && confSent !== '') ||
          (remSent && remSent !== '')
        ) {
          newStatus = 'confirmado'
        }

        var oldNotes = r.getString('notes') || ''
        var cleanNotes = oldNotes
          .replace(/\(Cancelado\/removido na agenda oficial\)/g, '')
          .replace(/Cancelado\/removido na agenda oficial/g, '')
          .trim()

        var restoredNote = 'Restaurado em 25/09 — cancelamento indevido pelo sync'
        var finalNotes = cleanNotes ? cleanNotes + ' (' + restoredNote + ')' : restoredNote

        r.set('status', newStatus)
        r.set('notes', finalNotes)
        r.set('updated', new Date().toISOString())

        try {
          app.saveNoValidate(r)
        } catch (saveErr) {
          app
            .logger()
            .error('migration 0123: erro ao salvar agendamento ' + r.id + ': ' + String(saveErr))
        }
      }
    } catch (e) {
      app.logger().error('migration 0123 erro fatal: ' + String(e))
    }
  },
  (app) => {
    try {
      var records = app.findRecordsByFilter(
        'appointments',
        'notes ~ "cancelamento indevido pelo sync" && starts_at >= "2026-10-25 00:00:00.000Z"',
        'starts_at',
        100,
        0,
      )
      for (var i = 0; i < records.length; i++) {
        var r = records[i]
        r.set('status', 'cancelado')
        r.set('notes', 'Cancelado/removido na agenda oficial')
        try {
          app.saveNoValidate(r)
        } catch (_) {}
      }
    } catch (_) {}
  },
)
