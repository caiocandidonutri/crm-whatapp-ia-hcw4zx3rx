migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')
    col.fields.add(
      new TextField({
        name: 'system_prompt',
        required: true,
        max: 50000,
      }),
    )
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')
    col.fields.add(
      new TextField({
        name: 'system_prompt',
        required: true,
        max: 5000,
      }),
    )
    app.save(col)
  },
)
