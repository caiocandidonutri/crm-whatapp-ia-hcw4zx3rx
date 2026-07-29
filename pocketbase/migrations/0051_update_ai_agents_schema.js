migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')
    col.fields.removeByName('provider')
    col.fields.removeByName('model')
    col.fields.removeByName('api_key')
    col.fields.removeByName('temperature')
    col.fields.removeByName('max_tokens')
    col.fields.removeByName('memory_window')
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')
    if (!col.fields.getByName('provider')) {
      col.fields.add(
        new SelectField({
          name: 'provider',
          values: ['openai', 'anthropic', 'gemini'],
          required: true,
        }),
      )
      col.fields.add(new TextField({ name: 'model', required: true }))
      col.fields.add(new TextField({ name: 'api_key', required: true }))
      col.fields.add(new NumberField({ name: 'temperature', required: true }))
      col.fields.add(new NumberField({ name: 'max_tokens', required: true }))
      col.fields.add(new NumberField({ name: 'memory_window', required: true }))
    }
    app.save(col)
  },
)
