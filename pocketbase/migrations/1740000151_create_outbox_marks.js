migrate(
  (app) => {
    // Verificar se outbox_marks já existe
    try {
      const existing = app.findCollectionByNameOrId('outbox_marks')
      if (existing) return
    } catch (_) {
      // Collection does not exist yet
    }

    const collection = new Collection({
      name: 'outbox_marks',
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: null, // Zero deletes
      fields: [
        new TextField({
          name: 'message_id',
          required: true,
        }),
        new SelectField({
          name: 'origin',
          values: ['ia', 'automacao'],
          maxSelect: 1,
          required: true,
        }),
      ],
      indexes: [
        'CREATE INDEX idx_outbox_marks_message_id ON outbox_marks (message_id)',
        'CREATE INDEX idx_outbox_marks_created ON outbox_marks (created)',
      ],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('outbox_marks')
      if (collection) {
        app.delete(collection)
      }
    } catch (_) {}
  },
)
