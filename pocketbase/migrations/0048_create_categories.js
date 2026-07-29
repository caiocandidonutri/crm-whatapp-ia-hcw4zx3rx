migrate(
  (app) => {
    const categories = new Collection({
      name: 'categories',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      createRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      updateRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      deleteRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('accounts').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'name', type: 'text', required: true, min: 1, max: 50 },
        {
          name: 'color',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'slate',
            'red',
            'orange',
            'amber',
            'yellow',
            'lime',
            'green',
            'emerald',
            'teal',
            'cyan',
            'sky',
            'blue',
            'indigo',
            'violet',
            'purple',
            'fuchsia',
            'pink',
            'rose',
          ],
        },
        { name: 'icon', type: 'text', max: 50 },
        { name: 'created_by', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_categories_account ON categories (account_id)'],
    })
    app.save(categories)

    const conversations = app.findCollectionByNameOrId('conversations')
    if (!conversations.fields.getByName('category_ids')) {
      conversations.fields.add(new JSONField({ name: 'category_ids', maxSize: 1048576 }))
      app.save(conversations)
    }

    const crmContacts = app.findCollectionByNameOrId('crm_contacts')
    if (!crmContacts.fields.getByName('category_ids')) {
      crmContacts.fields.add(new JSONField({ name: 'category_ids', maxSize: 1048576 }))
      app.save(crmContacts)
    }
  },
  (app) => {
    try {
      const categories = app.findCollectionByNameOrId('categories')
      app.delete(categories)
    } catch (_) {}

    try {
      const conversations = app.findCollectionByNameOrId('conversations')
      conversations.fields.removeByName('category_ids')
      app.save(conversations)
    } catch (_) {}

    try {
      const crmContacts = app.findCollectionByNameOrId('crm_contacts')
      crmContacts.fields.removeByName('category_ids')
      app.save(crmContacts)
    } catch (_) {}
  },
)
