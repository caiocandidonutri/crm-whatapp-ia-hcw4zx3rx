migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id

    var col = new Collection({
      name: 'message_templates',
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
          collectionId: accountsId,
          maxSelect: 1,
        },
        { name: 'name', type: 'text', required: true, max: 200 },
        {
          name: 'trigger_type',
          type: 'select',
          required: true,
          values: ['primeiro_contato', 'reengajamento', 'pos_consulta'],
          maxSelect: 1,
        },
        { name: 'content', type: 'text', required: true, max: 2000 },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_message_templates_account ON message_templates (account_id)',
        'CREATE INDEX idx_message_templates_trigger ON message_templates (trigger_type)',
      ],
    })
    app.save(col)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('message_templates'))
    } catch (_) {}
  },
)
