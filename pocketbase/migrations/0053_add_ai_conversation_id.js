migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    if (!col.fields.getByName('ai_conversation_id')) {
      col.fields.add(new TextField({ name: 'ai_conversation_id' }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    col.fields.removeByName('ai_conversation_id')
    app.save(col)
  },
)
