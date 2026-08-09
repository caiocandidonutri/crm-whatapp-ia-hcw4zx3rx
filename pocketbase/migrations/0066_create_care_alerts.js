migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id
    var contactsId = app.findCollectionByNameOrId('crm_contacts').id
    var conversationsId = app.findCollectionByNameOrId('conversations').id

    var settings = new Collection({
      name: 'care_alert_settings',
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
        { name: 'whatsapp_alert_phone', type: 'text', required: false, max: 30 },
        { name: 'followup_alert_enabled', type: 'bool', required: false },
        { name: 'needs_care_alert_enabled', type: 'bool', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_care_alert_settings_account ON care_alert_settings (account_id)'],
    })
    app.save(settings)

    var alerts = new Collection({
      name: 'care_alerts',
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
        {
          name: 'type',
          type: 'select',
          required: true,
          values: ['followup', 'needs_care'],
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
          name: 'conversation_id',
          type: 'relation',
          required: false,
          collectionId: conversationsId,
          maxSelect: 1,
        },
        { name: 'message', type: 'text', required: false, max: 2000 },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['pending', 'sent', 'failed'],
          maxSelect: 1,
        },
        { name: 'sent_at', type: 'date', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_care_alerts_account ON care_alerts (account_id)',
        'CREATE INDEX idx_care_alerts_type ON care_alerts (type)',
        'CREATE INDEX idx_care_alerts_status ON care_alerts (status)',
        'CREATE INDEX idx_care_alerts_created ON care_alerts (created)',
      ],
    })
    app.save(alerts)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('care_alert_settings'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('care_alerts'))
    } catch (_) {}
  },
)
