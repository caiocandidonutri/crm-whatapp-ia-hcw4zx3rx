migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    app.save(
      new Collection({
        name: 'crm_companies',
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
          { name: 'cnpj', type: 'text' },
          { name: 'website', type: 'text' },
          { name: 'linkedin_url', type: 'text' },
          { name: 'industry', type: 'text' },
          { name: 'size', type: 'text' },
          { name: 'logo_url', type: 'text' },
          { name: 'notes', type: 'editor' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
      }),
    )
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('crm_companies'))
  },
)
