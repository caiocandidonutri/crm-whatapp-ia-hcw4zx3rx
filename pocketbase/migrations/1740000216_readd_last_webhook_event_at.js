/// Migration idempotente — garante o campo de heartbeat do webhook em
/// whatsapp_instances. As migrations 1740000213/1740000214 constam como
/// aplicadas no backend mas os arquivos não existem mais na árvore e o
/// campo NÃO está no schema live (verificado por db_describe_object).
/// Esta migration recria o campo se ele não existir. Nunca apaga dados.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    let has = true
    try {
      col.fields.getByName('last_webhook_event_at')
    } catch (_) {
      has = false
    }

    if (!has) {
      col.fields.add(new DateField({ name: 'last_webhook_event_at' }))
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    try {
      col.fields.removeByName('last_webhook_event_at')
      app.save(col)
    } catch (_) {}
  },
)
