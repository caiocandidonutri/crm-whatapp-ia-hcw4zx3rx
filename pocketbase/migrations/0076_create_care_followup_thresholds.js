// Cria a collection `care_followup_thresholds` para configurar, por conta,
// após quantos dias sem resposta um paciente entra em cada categoria de
// cuidado (ex.: "Não respondeu" após 3 dias, "Precisa de atenção" após 7,
// "Perdido" após 15). Sementeia valores-padrão para as contas existentes.
migrate(
  (app) => {
    var accountsId = app.findCollectionByNameOrId('accounts').id

    var col = new Collection({
      name: 'care_followup_thresholds',
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
          name: 'category',
          type: 'select',
          required: true,
          values: ['nao_respondeu', 'precisa_atencao', 'perdido'],
          maxSelect: 1,
        },
        { name: 'days', type: 'number', required: true, min: 1, onlyInt: true },
        { name: 'enabled', type: 'bool', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_care_followup_thresholds_account ON care_followup_thresholds (account_id)',
        'CREATE UNIQUE INDEX idx_care_followup_thresholds_acc_cat ON care_followup_thresholds (account_id, category)',
      ],
    })
    app.save(col)

    // Sementeia valores-padrão para cada conta existente (idempotente).
    var DEFAULTS = [
      { category: 'nao_respondeu', days: 3 },
      { category: 'precisa_atencao', days: 7 },
      { category: 'perdido', days: 15 },
    ]

    var accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
    } catch (_) {
      accounts = []
    }

    for (var a = 0; a < accounts.length; a++) {
      var accountId = accounts[a].id
      for (var d = 0; d < DEFAULTS.length; d++) {
        var def = DEFAULTS[d]
        try {
          app.findFirstRecordByFilter(
            'care_followup_thresholds',
            'account_id = {:aid} && category = {:cat}',
            { aid: accountId, cat: def.category },
          )
          // já existe — mantém o valor configurado pelo usuário
        } catch (_) {
          var rec = new Record(col)
          rec.set('account_id', accountId)
          rec.set('category', def.category)
          rec.set('days', def.days)
          rec.set('enabled', true)
          app.save(rec)
        }
      }
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('care_followup_thresholds'))
    } catch (_) {}
  },
)
