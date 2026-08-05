migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (!col.fields.getByName('is_patient')) {
      col.fields.add(new BoolField({ name: 'is_patient', required: false }))
    }

    if (!col.fields.getByName('converted_at')) {
      col.fields.add(new DateField({ name: 'converted_at', required: false }))
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('crm_contacts')

    if (col.fields.getByName('is_patient')) {
      col.fields.removeByName('is_patient')
    }
    if (col.fields.getByName('converted_at')) {
      col.fields.removeByName('converted_at')
    }

    app.save(col)
  },
)
