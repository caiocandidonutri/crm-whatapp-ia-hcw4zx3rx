migrate(
  (app) => {
    var col = app.findCollectionByNameOrId('care_followup_rules')
    if (!col.fields.getByName('reminder_text')) {
      col.fields.add(new TextField({ name: 'reminder_text', required: false, max: 1000 }))
    }
    app.save(col)
  },
  (app) => {
    var col = app.findCollectionByNameOrId('care_followup_rules')
    if (col.fields.getByName('reminder_text')) {
      col.fields.removeByName('reminder_text')
    }
    app.save(col)
  },
)
