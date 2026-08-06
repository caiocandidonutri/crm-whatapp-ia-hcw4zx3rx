migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    if (!col.fields.getByName('last_health_check_at')) {
      col.fields.add(new DateField({ name: 'last_health_check_at' }))
    }
    if (!col.fields.getByName('last_webhook_reconfigured_at')) {
      col.fields.add(new DateField({ name: 'last_webhook_reconfigured_at' }))
    }
    if (!col.fields.getByName('last_instance_restart_at')) {
      col.fields.add(new DateField({ name: 'last_instance_restart_at' }))
    }
    if (!col.fields.getByName('health_check_failures')) {
      col.fields.add(new NumberField({ name: 'health_check_failures' }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    const fields = [
      'last_health_check_at',
      'last_webhook_reconfigured_at',
      'last_instance_restart_at',
      'health_check_failures',
    ]
    for (const fname of fields) {
      if (col.fields.getByName(fname)) {
        col.fields.removeByName(fname)
      }
    }
    app.save(col)
  },
)
