migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id

    var rules = new Collection({
      name: 'care_followup_rules',
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
        { name: 'name', type: 'text', required: true, max: 100 },
        { name: 'followup_days', type: 'number', required: true, min: 1, max: 365, onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_care_followup_rules_account ON care_followup_rules (account_id)'],
    })
    app.save(rules)

    var contactsCol = app.findCollectionByNameOrId('crm_contacts')
    if (!contactsCol.fields.getByName('followup_rule_id')) {
      contactsCol.fields.add(
        new RelationField({
          name: 'followup_rule_id',
          required: false,
          collectionId: rules.id,
          maxSelect: 1,
        }),
      )
    }
    app.save(contactsCol)

    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {}

    var defaults = [
      { name: 'Consulta inicial', followup_days: 7 },
      { name: 'Retorno de SOP', followup_days: 15 },
      { name: 'Procedimento hormonal', followup_days: 5 },
    ]

    for (var a = 0; a < accounts.length; a++) {
      var accountId = accounts[a].id
      for (var d = 0; d < defaults.length; d++) {
        try {
          app.findFirstRecordByFilter('care_followup_rules', 'account_id = {:aid} && name = {:n}', {
            aid: accountId,
            n: defaults[d].name,
          })
        } catch (_) {
          var ruleCol = app.findCollectionByNameOrId('care_followup_rules')
          var rule = new Record(ruleCol)
          rule.set('account_id', accountId)
          rule.set('name', defaults[d].name)
          rule.set('followup_days', defaults[d].followup_days)
          app.save(rule)
        }
      }
    }
  },
  (app) => {
    try {
      var contactsCol = app.findCollectionByNameOrId('crm_contacts')
      if (contactsCol.fields.getByName('followup_rule_id')) {
        contactsCol.fields.removeByName('followup_rule_id')
      }
      app.save(contactsCol)
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('care_followup_rules'))
    } catch (_) {}
  },
)
