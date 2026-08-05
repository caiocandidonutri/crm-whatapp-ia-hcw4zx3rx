migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (!col.fields.getByName('ai_suggested_action')) {
      col.fields.add(new TextField({ name: 'ai_suggested_action', required: false, max: 500 }))
    }

    if (!col.fields.getByName('ai_priority')) {
      col.fields.add(new NumberField({ name: 'ai_priority', required: false }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (col.fields.getByName('ai_suggested_action')) {
      col.fields.removeByName('ai_suggested_action')
    }
    if (col.fields.getByName('ai_priority')) {
      col.fields.removeByName('ai_priority')
    }

    app.save(col)
  },
)
