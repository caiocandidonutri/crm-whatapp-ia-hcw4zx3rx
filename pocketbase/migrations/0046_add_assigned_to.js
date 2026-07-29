migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    tasks.fields.add(
      new RelationField({
        name: 'assigned_to',
        type: 'relation',
        required: false,
        collectionId: '_pb_users_auth_',
        cascadeDelete: false,
        maxSelect: 1,
      }),
    )
    app.save(tasks)

    const crm = app.findCollectionByNameOrId('crm_contacts')
    crm.fields.add(
      new RelationField({
        name: 'assigned_to',
        type: 'relation',
        required: false,
        collectionId: '_pb_users_auth_',
        cascadeDelete: false,
        maxSelect: 1,
      }),
    )
    app.save(crm)
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks')
    tasks.fields.removeByName('assigned_to')
    app.save(tasks)

    const crm = app.findCollectionByNameOrId('crm_contacts')
    crm.fields.removeByName('assigned_to')
    app.save(crm)
  },
)
