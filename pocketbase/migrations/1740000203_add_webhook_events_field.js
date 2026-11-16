/// <reference path="../pb_data/types.d.ts" />
// v0.0.252 — PASSO 3: campo webhook_events na whatsapp_instances (soft idempotente).
// last_webhook_reconfigured_at já existia; este cria apenas o que falta.
// Zero deletes — nunca remove campo/dados existentes.

migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId('whatsapp_instances')

    const addFieldIfMissing = (name, type, options) => {
      try {
        coll.fields.getByName(name)
        return // já existe — no-op
      } catch (_) {
        // não existe — cria
      }
      coll.fields.add(new Field({ type, name, ...options }))
    }

    addFieldIfMissing('webhook_events', 'text', {})
    addFieldIfMissing('last_webhook_reconfigured_at', 'date', {})

    app.save(coll)
  },
  (app) => {
    // Down: no-op deliberado (nunca apagar dados).
  },
)
