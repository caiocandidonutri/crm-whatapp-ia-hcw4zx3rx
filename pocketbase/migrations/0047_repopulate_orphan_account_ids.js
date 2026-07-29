migrate(
  (app) => {
    const collections = [
      'whatsapp_instances',
      'conversations',
      'whatsapp_messages',
      'mark_read_queue',
      'crm_contacts',
      'crm_companies',
      'ai_agents',
      'tasks',
    ]

    let totalUpdated = 0

    const userToAccount = {}
    try {
      const members = app.findRecordsByFilter('account_members', '1=1', '', 100000, 0)
      for (const m of members) {
        const uId = m.getString('user_id')
        if (!userToAccount[uId]) {
          userToAccount[uId] = m.getString('account_id')
        }
      }
    } catch (err) {
      console.log('Error loading account members: ' + String(err))
    }

    for (const collName of collections) {
      try {
        const records = app.findRecordsByFilter(collName, "account_id = ''", '', 100000, 0)
        for (const record of records) {
          const uId = record.getString('user_id')
          if (uId && userToAccount[uId]) {
            record.set('account_id', userToAccount[uId])
            if (typeof app.saveNoValidate === 'function') {
              app.saveNoValidate(record)
            } else {
              app.save(record)
            }
            totalUpdated++
          }
        }
      } catch (err) {
        console.log('Error updating ' + collName + ': ' + String(err))
      }
    }

    console.log('Backfilled account_id for ' + totalUpdated + ' orphan records.')
  },
  (app) => {
    // Irreversible
  },
)
