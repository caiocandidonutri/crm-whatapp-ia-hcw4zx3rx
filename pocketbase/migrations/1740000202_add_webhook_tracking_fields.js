/// Migration soft idempotente — campos de rastreio de webhook em whatsapp_instances.
/// Nunca apaga dados: só CRIA os campos se ainda não existirem.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    const hasField = (name) => {
      try {
        col.fields.getByName(name)
        return true
      } catch (_) {
        return false
      }
    }

    if (!hasField('last_webhook_reconfigured_at')) {
      col.fields.add(new DateField({ name: 'last_webhook_reconfigured_at' }))
      app.save(col)
    }

    if (!hasField('webhook_events')) {
      col.fields.add(new TextField({ name: 'webhook_events' }))
      app.save(col)
    }
  },
  (app) => {
    // Down: remove os campos apenas se existirem (idempotente).
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const names = ['last_webhook_reconfigured_at', 'webhook_events']
    let changed = false
    for (const name of names) {
      try {
        col.fields.removeByName(name)
        changed = true
      } catch (_) {}
    }
    if (changed) app.save(col)
  },
)
