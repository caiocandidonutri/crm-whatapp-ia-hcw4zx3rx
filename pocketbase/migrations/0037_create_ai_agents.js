migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    app.save(
      new Collection({
        name: 'ai_agents',
        type: 'base',
        listRule: "@request.auth.id != '' && user_id = @request.auth.id",
        viewRule: "@request.auth.id != '' && user_id = @request.auth.id",
        createRule: "@request.auth.id != '' && user_id = @request.auth.id",
        updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
        deleteRule: "@request.auth.id != '' && user_id = @request.auth.id",
        fields: [
          {
            name: 'user_id',
            type: 'relation',
            required: true,
            collectionId: usersId,
            maxSelect: 1,
          },
          { name: 'name', type: 'text', required: true },
          { name: 'system_prompt', type: 'text', required: true },
          {
            name: 'provider',
            type: 'select',
            required: true,
            values: ['openai', 'anthropic', 'gemini'],
            maxSelect: 1,
          },
          { name: 'model', type: 'text', required: true },
          { name: 'api_key', type: 'text', required: true },
          { name: 'temperature', type: 'number', required: true },
          { name: 'max_tokens', type: 'number', required: true },
          { name: 'memory_window', type: 'number', required: true },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
      }),
    )
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('ai_agents'))
  },
)
