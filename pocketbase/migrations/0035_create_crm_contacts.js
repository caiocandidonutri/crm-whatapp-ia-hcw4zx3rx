migrate(
  (app) => {
    const usersId = '_pb_users_auth_'
    app.save(
      new Collection({
        name: 'crm_contacts',
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
          { name: 'instance_name', type: 'text', required: true },
          { name: 'jid', type: 'text', required: true },
          { name: 'phone', type: 'text' },
          { name: 'push_name', type: 'text' },
          { name: 'contact_name', type: 'text' },
          { name: 'avatar_url', type: 'text' },
          { name: 'notes', type: 'editor' },
          {
            name: 'stage',
            type: 'select',
            required: true,
            values: ['lead', 'em_atendimento', 'cliente', 'perdido'],
            maxSelect: 1,
          },
          { name: 'last_synced_at', type: 'date' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          { name: 'role', type: 'text' },
          { name: 'email', type: 'text' },
        ],
      }),
    )
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('crm_contacts'))
  },
)
