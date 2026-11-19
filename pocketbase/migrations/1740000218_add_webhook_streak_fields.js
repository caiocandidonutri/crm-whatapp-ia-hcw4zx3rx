//
// Idempotent: adiciona os campos de rastreio de webhook/restart à coleção whatsapp_instances.
// Re-executa com segurança caso um arquivo anterior (1740000217) tenha sido
// registrado como aplicado mas não tenha efetivamente criado os campos.
//
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    if (!col.fields.getByName('webhook_reconfigured_streak')) {
      col.fields.add(new NumberField({ name: 'webhook_reconfigured_streak', onlyInt: true }))
    }
    if (!col.fields.getByName('last_webhook_event_at')) {
      col.fields.add(new DateField({ name: 'last_webhook_event_at' }))
    }
    if (!col.fields.getByName('last_instance_restart_at')) {
      col.fields.add(new DateField({ name: 'last_instance_restart_at' }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    for (const name of [
      'webhook_reconfigured_streak',
      'last_webhook_event_at',
      'last_instance_restart_at',
    ]) {
      const f = col.fields.getByName(name)
      if (f) col.fields.remove(f)
    }
    app.save(col)
  },
)
