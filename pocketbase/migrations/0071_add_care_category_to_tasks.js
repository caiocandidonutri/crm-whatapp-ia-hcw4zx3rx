migrate(
  (app) => {
    var col = app.findCollectionByNameOrId('tasks')

    if (!col.fields.getByName('care_category')) {
      col.fields.add(
        new SelectField({
          name: 'care_category',
          required: false,
          values: [
            'sem_categoria',
            'nao_respondeu',
            'precisa_retorno',
            'precisa_consulta',
            'precisa_atencao',
            'followup_10_15',
            'alta_demanda',
          ],
          maxSelect: 1,
        }),
      )
    }

    col.addIndex('idx_tasks_care_category', false, 'care_category', '')
    col.addIndex('idx_tasks_crm_contact_id', false, 'crm_contact_id', '')

    app.save(col)

    app
      .db()
      .newQuery(
        "UPDATE tasks SET care_category = 'sem_categoria' WHERE care_category = '' OR care_category IS NULL",
      )
      .execute()
  },
  (app) => {
    var col = app.findCollectionByNameOrId('tasks')
    if (col.fields.getByName('care_category')) {
      col.fields.removeByName('care_category')
    }
    col.removeIndex('idx_tasks_care_category')
    col.removeIndex('idx_tasks_crm_contact_id')
    app.save(col)
  },
)
