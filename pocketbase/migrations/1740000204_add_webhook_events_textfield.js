/// <reference path="../pb_data/types.d.ts" />
// v0.0.252 — PASSO 3 (corretiva): webhook_events ainda não existia em
// whatsapp_instances; a tentativa via `new Field({type:'text'})` foi no-op.
// Aqui usa `new TextField` (padrão que funcionou na migration 1740000202).
// Soft idempotente: só CRIA o que falta, zero deletes.

migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId('whatsapp_instances')
    let changed = false

    try {
      coll.fields.getByName('webhook_events')
    } catch (_) {
      coll.fields.add(new TextField({ name: 'webhook_events' }))
      changed = true
    }

    try {
      coll.fields.getByName('last_webhook_reconfigured_at')
    } catch (_) {
      coll.fields.add(new DateField({ name: 'last_webhook_reconfigured_at' }))
      changed = true
    }

    if (changed) app.save(coll)
  },
  (app) => {
    // Down: no-op deliberado (nunca apagar dados).
  },
)
