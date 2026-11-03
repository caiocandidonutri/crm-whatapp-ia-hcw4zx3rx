migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('outbox_marks')
    col.createRule = '@request.auth.id != ""'
    col.deleteRule = null // Zero deletes
    if (!col.fields.getByName('message_id')) {
      col.fields.add(new TextField({ name: 'message_id', required: true }))
    }
    if (!col.fields.getByName('origin')) {
      col.fields.add(
        new SelectField({
          name: 'origin',
          values: ['ia', 'automacao'],
          maxSelect: 1,
          required: true,
        }),
      )
    }
    app.save(col)
  },
  (app) => {},
)
