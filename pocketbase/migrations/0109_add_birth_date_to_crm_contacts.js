/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (!col.fields.getByName('birth_date')) {
      col.fields.add(new TextField({ name: 'birth_date', required: false }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (col.fields.getByName('birth_date')) {
      col.fields.removeByName('birth_date')
    }

    app.save(col)
  },
)
