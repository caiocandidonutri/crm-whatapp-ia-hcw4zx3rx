migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    if (!col.fields.getByName('assigned_to')) {
      col.fields.add(
        new RelationField({
          name: 'assigned_to',
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        }),
      )
      app.save(col)
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId('conversations')
    if (col.fields.getByName('assigned_to')) {
      col.fields.removeByName('assigned_to')
      app.save(col)
    }
  },
)
