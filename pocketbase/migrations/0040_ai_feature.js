migrate(
  (app) => {
    const conv = app.findCollectionByNameOrId('conversations')
    const agents = app.findCollectionByNameOrId('ai_agents')
    conv.fields.add(
      new RelationField({ name: 'ai_agent_id', collectionId: agents.id, maxSelect: 1 }),
    )
    conv.fields.add(new BoolField({ name: 'ai_enabled' }))
    app.save(conv)

    const msg = app.findCollectionByNameOrId('whatsapp_messages')
    msg.fields.add(new BoolField({ name: 'pending_ai_response' }))
    msg.fields.add(new DateField({ name: 'ai_response_attempted_at' }))
    msg.fields.add(new TextField({ name: 'ai_response_error' }))
    app.save(msg)
  },
  (app) => {
    const conv = app.findCollectionByNameOrId('conversations')
    conv.fields.removeByName('ai_agent_id')
    conv.fields.removeByName('ai_enabled')
    app.save(conv)

    const msg = app.findCollectionByNameOrId('whatsapp_messages')
    msg.fields.removeByName('pending_ai_response')
    msg.fields.removeByName('ai_response_attempted_at')
    msg.fields.removeByName('ai_response_error')
    app.save(msg)
  },
)
