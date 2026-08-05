migrate(
  (app) => {
    let accounts = []
    try {
      accounts = app.findRecordsByFilter('accounts', "id != ''", '+created', 1000, 0)
    } catch (e) {
      return
    }

    for (const account of accounts) {
      const accountId = account.id

      try {
        app.findFirstRecordByFilter('crm_stages', 'account_id = {:accountId} && key = {:key}', {
          accountId: accountId,
          key: 'nao_respondido',
        })
        continue
      } catch (_) {}

      let maxPosition = 0
      try {
        const stages = app.findRecordsByFilter(
          'crm_stages',
          'account_id = {:accountId}',
          '-position',
          1,
          0,
          { accountId: accountId },
        )
        if (stages.length > 0) {
          maxPosition = stages[0].getInt('position') || 0
        }
      } catch (_) {}

      try {
        const col = app.findCollectionByNameOrId('crm_stages')
        const record = new Record(col)
        record.set('account_id', accountId)
        record.set('key', 'nao_respondido')
        record.set('label', 'Não Respondidos')
        record.set('color', 'slate')
        record.set('position', maxPosition + 1)
        app.save(record)
      } catch (err) {
        console.log('Failed to create nao_respondido stage for account ' + accountId, err)
      }
    }
  },
  (app) => {
    try {
      const stages = app.findRecordsByFilter(
        'crm_stages',
        "key = 'nao_respondido'",
        '+created',
        1000,
        0,
      )
      for (const s of stages) {
        app.delete(s)
      }
    } catch (_) {}
  },
)
