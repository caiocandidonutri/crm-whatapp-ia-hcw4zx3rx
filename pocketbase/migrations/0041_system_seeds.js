migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')
    try {
      app.findAuthRecordByEmail('_pb_users_auth_', 'fabiano@adapta.org')
      return
    } catch (_) {}

    const record = new Record(users)
    record.setEmail('fabiano@adapta.org')
    record.setPassword('Skip@Pass')
    record.setVerified(true)
    record.set('name', 'Admin')
    app.save(record)
  },
  (app) => {
    try {
      const record = app.findAuthRecordByEmail('_pb_users_auth_', 'fabiano@adapta.org')
      app.delete(record)
    } catch (_) {}
  },
)
