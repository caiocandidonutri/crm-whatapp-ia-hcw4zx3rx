migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    if (!col.fields.getByName('import_total_count')) {
      col.fields.add(new NumberField({ name: 'import_total_count' }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('whatsapp_instances')
    if (col.fields.getByName('import_total_count')) {
      col.fields.removeByName('import_total_count')
    }
    app.save(col)
  },
)
