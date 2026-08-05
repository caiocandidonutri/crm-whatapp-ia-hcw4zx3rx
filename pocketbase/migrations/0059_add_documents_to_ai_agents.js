migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')

    if (!col.fields.getByName('documents')) {
      col.fields.add(
        new FileField({
          name: 'documents',
          maxSelect: 10,
          maxSize: 10485760,
          mimeTypes: [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
        }),
      )
    }

    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ai_agents')

    if (col.fields.getByName('documents')) {
      col.fields.removeByName('documents')
    }

    app.save(col)
  },
)
