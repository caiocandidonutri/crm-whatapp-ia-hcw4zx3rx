migrate(
  (app) => {
    // 1) Coleção crm_stages — etapas do pipeline editáveis por conta.
    var exists = false
    try {
      app.findCollectionByNameOrId('crm_stages')
      exists = true
    } catch (e) {
      exists = false
    }

    if (!exists) {
      var rule =
        "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id"

      var stages = new Collection({
        name: 'crm_stages',
        type: 'base',
        listRule: rule,
        viewRule: rule,
        createRule: rule,
        updateRule: rule,
        deleteRule: rule,
        fields: [
          {
            name: 'account_id',
            type: 'relation',
            required: true,
            collectionId: app.findCollectionByNameOrId('accounts').id,
            cascadeDelete: true,
            maxSelect: 1,
          },
          { name: 'key', type: 'text', required: true, min: 1, max: 50 },
          { name: 'label', type: 'text', required: true, min: 1, max: 50 },
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
          { name: 'position', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_crm_stages_account ON crm_stages (account_id)',
          'CREATE UNIQUE INDEX idx_crm_stages_acc_key ON crm_stages (account_id, key)',
        ],
      })
      app.save(stages)
    }

    // 2) Converte crm_contacts.stage de select fixo -> text livre (permite
    //    etapas customizadas). O PocketBase NÃO deixa trocar o tipo de um
    //    campo existente, então removemos e recriamos como text. Como
    //    remover dropa a coluna, fazemos snapshot dos valores e restauramos.
    var contacts = app.findCollectionByNameOrId('crm_contacts')
    var stageField = contacts.fields.getByName('stage')
    if (stageField) {
      var snapshot = {}
      var recs = app.findAllRecords('crm_contacts')
      for (var i = 0; i < recs.length; i++) {
        snapshot[recs[i].id] = recs[i].getString('stage')
      }

      contacts.fields.removeByName('stage')
      app.save(contacts)

      contacts.fields.add(new TextField({ name: 'stage', required: false, max: 50 }))
      app.save(contacts)

      for (var j = 0; j < recs.length; j++) {
        var val = snapshot[recs[j].id]
        if (!val) continue
        try {
          var r = app.findRecordById('crm_contacts', recs[j].id)
          r.set('stage', val)
          app.save(r)
        } catch (e2) {}
      }
    }
  },
  (app) => {
    // Down: volta stage pra select fixo (remove + recria) e dropa crm_stages.
    try {
      var contacts = app.findCollectionByNameOrId('crm_contacts')
      var snapshot = {}
      var recs = app.findAllRecords('crm_contacts')
      for (var i = 0; i < recs.length; i++) {
        snapshot[recs[i].id] = recs[i].getString('stage')
      }
      if (contacts.fields.getByName('stage')) {
        contacts.fields.removeByName('stage')
        app.save(contacts)
      }
      contacts.fields.add(
        new SelectField({
          name: 'stage',
          required: true,
          maxSelect: 1,
          values: ['lead', 'em_atendimento', 'cliente', 'perdido'],
        }),
      )
      app.save(contacts)
      for (var j = 0; j < recs.length; j++) {
        var val = snapshot[recs[j].id]
        if (val !== 'lead' && val !== 'em_atendimento' && val !== 'cliente' && val !== 'perdido')
          continue
        try {
          var r = app.findRecordById('crm_contacts', recs[j].id)
          r.set('stage', val)
          app.save(r)
        } catch (e2) {}
      }
    } catch (e) {}

    try {
      var stages = app.findCollectionByNameOrId('crm_stages')
      app.delete(stages)
    } catch (e3) {}
  },
)
