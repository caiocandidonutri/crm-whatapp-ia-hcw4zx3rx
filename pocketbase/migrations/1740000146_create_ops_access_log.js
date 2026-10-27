migrate(
  (app) => {
    const collection = new Collection({
      name: 'ops_access_log',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null, // superuser/hook only
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'route', type: 'text', required: true },
        { name: 'patient_code', type: 'text' },
        { name: 'ip', type: 'text' },
        { name: 'status_code', type: 'number' },
        { name: 'query_params', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_ops_access_log_created ON ops_access_log (created DESC)',
        'CREATE INDEX idx_ops_access_log_route ON ops_access_log (route)',
        'CREATE INDEX idx_ops_access_log_code ON ops_access_log (patient_code)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('ops_access_log')
      app.delete(col)
    } catch (_) {}
  },
)
