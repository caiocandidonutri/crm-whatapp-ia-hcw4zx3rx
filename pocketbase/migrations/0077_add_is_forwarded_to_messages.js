// Adiciona o campo `is_forwarded` (bool) à collection whatsapp_messages,
// usado pelo webhook para marcar mensagens encaminhadas
// (contextInfo.isForwarded = true no payload do WhatsApp/Baileys).
// O front exibe um badge "Encaminhado" nos cards de mensagem quando esse
// campo é true. Não é required (ausente = false), conforme convenção de
// flags booleanas no PocketBase.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_messages')
    if (!col.fields.getByName('is_forwarded')) {
      col.fields.add(new BoolField({ name: 'is_forwarded' }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_messages')
    const f = col.fields.getByName('is_forwarded')
    if (f) col.fields.remove(f)
    app.save(col)
  },
)
