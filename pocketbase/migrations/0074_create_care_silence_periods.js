migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id

    var col = new Collection({
      name: 'care_silence_periods',
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
        { name: 'start_time', type: 'text', required: true, max: 5 },
        { name: 'end_time', type: 'text', required: true, max: 5 },
        { name: 'weekdays', type: 'json', required: false },
        { name: 'enabled', type: 'bool', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_care_silence_periods_account ON care_silence_periods (account_id)',
      ],
    })
    app.save(col)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('care_silence_periods'))
    } catch (_) {}
  },
)
