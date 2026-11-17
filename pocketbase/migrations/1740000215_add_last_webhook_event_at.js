/// Migration idempotente — campo de heartbeat do webhook em whatsapp_instances.
/// last_webhook_event_at = data/hora do ÚLTIMO POST recebido em
/// /backend/v1/whatsapp/webhook (qualquer evento), gravado pelo
/// whatsapp_webhook.js. É a base do monitor de silêncio (cron a cada 15min):
/// instância connected sem evento há >15min = webhook morto.
/// Nunca apaga dados: só CRIA o campo se ainda não existir.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')

    let has = false
    try {
      col.fields.getByName('last_webhook_event_at')
      has = true
    } catch (_) {
      has = false
    }

    if (!has) {
      col.fields.add(new DateField({ name: 'last_webhook_event_at' }))
      app.save(col)
    }
  },
  (app) => {
    // Down: remove o campo apenas se existir (idempotente).
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    try {
      col.fields.removeByName('last_webhook_event_at')
      app.save(col)
    } catch (_) {}
  },
)
