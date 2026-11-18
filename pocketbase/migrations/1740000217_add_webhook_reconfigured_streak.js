/// Migration 1740000217 — contador de regravações de webhook sem evento.
/// O repair hook usa webhook_reconfigured_streak para decidir o RESTART da
/// instância: 3 regravações seguidas sem nenhum evento chegar (heartbeat
/// last_webhook_event_at parado) = socket zumbi → POST /instance/restart/{name}.
/// last_webhook_event_at já foi garantido pela migration 1740000216 (idempotente);
/// esta migration só adiciona o contador se faltar. Nunca apaga dados.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    let has = true
    try {
      col.fields.getByName('webhook_reconfigured_streak')
    } catch (_) {
      has = false
    }

    if (!has) {
      col.fields.add(new NumberField({ name: 'webhook_reconfigured_streak', onlyInt: true }))
      app.save(col)
    }

    // Garantia extra (idempotente): last_webhook_event_at deve existir — as
    // migrations 213-216 constam aplicadas mas o campo já sumiu do schema live
    // antes; se faltar aqui, recria.
    let hasHeartbeat = true
    try {
      col.fields.getByName('last_webhook_event_at')
    } catch (_) {
      hasHeartbeat = false
    }
    if (!hasHeartbeat) {
      col.fields.add(new DateField({ name: 'last_webhook_event_at' }))
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    try {
      col.fields.removeByName('webhook_reconfigured_streak')
      app.save(col)
    } catch (_) {}
  },
)
