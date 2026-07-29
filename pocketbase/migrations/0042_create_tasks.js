migrate(
  (app) => {
    // Idempotency check
    try {
      app.findCollectionByNameOrId('tasks')
      return // Already exists
    } catch (_) {}

    const usersCollection = app.findCollectionByNameOrId('users')
    const crmContactsCollection = app.findCollectionByNameOrId('crm_contacts')
    const crmCompaniesCollection = app.findCollectionByNameOrId('crm_companies')
    const conversationsCollection = app.findCollectionByNameOrId('conversations')

    const collection = new Collection({
      name: 'tasks',
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
          collectionId: usersCollection.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          min: 1,
          max: 200,
        },
        {
          name: 'description',
          type: 'editor',
          required: false,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pendente', 'em_andamento', 'concluida', 'cancelada'],
        },
        {
          name: 'priority',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['baixa', 'media', 'alta', 'urgente'],
        },
        {
          name: 'due_date',
          type: 'date',
          required: false,
        },
        {
          name: 'crm_contact_id',
          type: 'relation',
          required: false,
          collectionId: crmContactsCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'crm_company_id',
          type: 'relation',
          required: false,
          collectionId: crmCompaniesCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'conversation_id',
          type: 'relation',
          required: false,
          collectionId: conversationsCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'linked_message_ids',
          type: 'json',
          required: false,
        },
        {
          name: 'completed_at',
          type: 'date',
          required: false,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        'CREATE INDEX idx_tasks_user_status ON tasks (user_id, status)',
        'CREATE INDEX idx_tasks_user_due ON tasks (user_id, due_date)',
      ],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('tasks')
      app.delete(collection)
    } catch (_) {}
  },
)
