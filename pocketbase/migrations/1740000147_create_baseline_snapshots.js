migrate(
  (app) => {
    // 1) Permitir o status 'arquivada_baseline' na collection tasks
    try {
      const tasksCol = app.findCollectionByNameOrId('tasks')
      const statusField = tasksCol.fields.getByName('status')
      if (statusField) {
        const curValues = statusField.values || []
        if (curValues.indexOf('arquivada_baseline') === -1) {
          statusField.values = curValues.concat(['arquivada_baseline'])
          app.save(tasksCol)
        }
      }
    } catch (e) {
      console.log('Error updating tasks status values:', e)
    }

    // 2) Criar collection baseline_snapshots
    const accountsCol = app.findCollectionByNameOrId('accounts')
    const collection = new Collection({
      name: 'baseline_snapshots',
      type: 'base',
      listRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id && account_id.account_members_via_account_id.role = 'owner'",
      viewRule:
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id && account_id.account_members_via_account_id.role = 'owner'",
      createRule: null, // superuser/hook/script only
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: false,
          collectionId: accountsCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'collection_name', type: 'text', required: true, max: 100 },
        { name: 'record_id', type: 'text', required: true, max: 100 },
        { name: 'field', type: 'text', required: true, max: 100 },
        { name: 'old_value', type: 'text', required: false },
        { name: 'reason', type: 'text', required: true, max: 150 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_baseline_snapshots_reason ON baseline_snapshots (reason)',
        'CREATE INDEX idx_baseline_snapshots_rec ON baseline_snapshots (collection_name, record_id)',
        'CREATE INDEX idx_baseline_snapshots_acc ON baseline_snapshots (account_id)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('baseline_snapshots')
      app.delete(col)
    } catch (_) {}
  },
)
