/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    var syncKey = 'agenda_externa_dr_caio'
    try {
      var syncStateRec = app.findFirstRecordByData('sync_state', 'key', syncKey)
      syncStateRec.set('last_status', 'pending')
      syncStateRec.set('last_error', '')
      syncStateRec.set(
        'details',
        JSON.stringify({
          message: 'Configurado para chamada direta com token estático no endpoint crm-dados',
          updated_at: new Date().toISOString(),
        }),
      )
      app.save(syncStateRec)
    } catch (_) {}
  },
  (app) => {},
)
