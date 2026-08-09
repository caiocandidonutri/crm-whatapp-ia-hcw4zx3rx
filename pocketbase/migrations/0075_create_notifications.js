migrate(
  (app) => {
    var usersId = '_pb_users_auth_'
    var accountsId = app.findCollectionByNameOrId('accounts').id
    var conversationsId = app.findCollectionByNameOrId('conversations').id
    var contactsId = app.findCollectionByNameOrId('crm_contacts').id
    var tasksId = app.findCollectionByNameOrId('tasks').id

    var col = new Collection({
      name: 'notifications',
      type: 'base',
      listRule: '@request.auth.id != "" && user_id = @request.auth.id',
      viewRule: '@request.auth.id != "" && user_id = @request.auth.id',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != "" && user_id = @request.auth.id',
      deleteRule: '@request.auth.id != "" && user_id = @request.auth.id',
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: usersId,
          maxSelect: 1,
        },
        {
          name: 'account_id',
          type: 'relation',
          required: false,
          collectionId: accountsId,
          maxSelect: 1,
        },
        {
          name: 'type',
          type: 'select',
          required: true,
          values: ['message', 'care_alert', 'task'],
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true, max: 200 },
        { name: 'body', type: 'text', required: false, max: 500 },
        {
          name: 'conversation_id',
          type: 'relation',
          required: false,
          collectionId: conversationsId,
          maxSelect: 1,
        },
        {
          name: 'crm_contact_id',
          type: 'relation',
          required: false,
          collectionId: contactsId,
          maxSelect: 1,
        },
        {
          name: 'task_id',
          type: 'relation',
          required: false,
          collectionId: tasksId,
          maxSelect: 1,
        },
        { name: 'read', type: 'bool', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_notifications_user ON notifications (user_id)',
        'CREATE INDEX idx_notifications_account ON notifications (account_id)',
        'CREATE INDEX idx_notifications_read ON notifications (read)',
      ],
    })
    app.save(col)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('notifications'))
    } catch (_) {}
  },
)
