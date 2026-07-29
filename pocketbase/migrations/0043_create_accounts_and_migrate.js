migrate(
  (app) => {
    // 1. Create accounts collection
    const accounts = new Collection({
      name: 'accounts',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'name', type: 'text', required: true, min: 1, max: 100 },
        {
          name: 'owner_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(accounts)

    // 2. Create account_members
    const account_members = new Collection({
      name: 'account_members',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accounts.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'user_id',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'role', type: 'select', required: true, values: ['owner', 'member'] },
        { name: 'joined_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_account_members_acc_user ON account_members (account_id, user_id)',
      ],
    })
    app.save(account_members)

    // 3. Create account_invites
    const account_invites = new Collection({
      name: 'account_invites',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'account_id',
          type: 'relation',
          required: true,
          collectionId: accounts.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'email', type: 'email', required: true },
        { name: 'role', type: 'select', required: true, values: ['owner', 'member'] },
        {
          name: 'invited_by',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_account_invites_acc_email ON account_invites (account_id, email)',
      ],
    })
    app.save(account_invites)

    // 4. Update existing collections to add account_id
    const collectionsToUpdate = [
      'whatsapp_instances',
      'conversations',
      'whatsapp_messages',
      'mark_read_queue',
      'crm_contacts',
      'crm_companies',
      'ai_agents',
      'tasks',
    ]

    collectionsToUpdate.forEach((colName) => {
      try {
        const col = app.findCollectionByNameOrId(colName)
        if (!col.fields.getByName('account_id')) {
          col.fields.add(
            new RelationField({
              name: 'account_id',
              collectionId: accounts.id,
              cascadeDelete: true,
              maxSelect: 1,
            }),
          )
          app.save(col)
        }
      } catch (e) {
        console.log(`Collection ${colName} not found or error adding field: `, e)
      }
    })

    // 5. Data Migration
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const allUsers = app.findRecordsByFilter(usersCol.id, '1=1', '', 10000, 0)

    const userAccountMap = {}

    allUsers.forEach((user) => {
      let account
      try {
        account = app.findFirstRecordByData('accounts', 'owner_id', user.id)
      } catch (_) {
        account = new Record(accounts)
        const name = user.getString('name') || user.getString('email') || 'Usuário'
        account.set('name', `Conta de ${name}`)
        account.set('owner_id', user.id)
        app.save(account)
        console.log(`Conta criada pra ${user.getString('email')}`)
      }

      userAccountMap[user.id] = account.id

      let member
      try {
        member = app.findFirstRecordByFilter(
          'account_members',
          `account_id = '${account.id}' && user_id = '${user.id}'`,
        )
      } catch (_) {
        member = new Record(account_members)
        member.set('account_id', account.id)
        member.set('user_id', user.id)
        member.set('role', 'owner')
        member.set('joined_at', new Date().toISOString())
        app.save(member)
      }
    })

    // 6. Update records in business collections
    collectionsToUpdate.forEach((colName) => {
      try {
        const col = app.findCollectionByNameOrId(colName)
        let offset = 0
        const batchSize = 1000
        let records

        do {
          records = app.findRecordsByFilter(colName, '1=1', 'id', batchSize, offset)
          records.forEach((record) => {
            if (!record.getString('account_id')) {
              const userId = record.getString('user_id')
              if (userId && userAccountMap[userId]) {
                record.set('account_id', userAccountMap[userId])
                app.saveNoValidate(record)
              }
            }
          })
          offset += batchSize
        } while (records.length === batchSize)
      } catch (e) {
        console.log(`Error updating records for ${colName}: `, e)
      }
    })
  },
  (app) => {
    const collectionsToUpdate = [
      'whatsapp_instances',
      'conversations',
      'whatsapp_messages',
      'mark_read_queue',
      'crm_contacts',
      'crm_companies',
      'ai_agents',
      'tasks',
    ]

    collectionsToUpdate.forEach((colName) => {
      try {
        const col = app.findCollectionByNameOrId(colName)
        if (col.fields.getByName('account_id')) {
          col.fields.removeByName('account_id')
          app.save(col)
        }
      } catch (e) {}
    })

    try {
      app.delete(app.findCollectionByNameOrId('account_invites'))
    } catch (e) {}
    try {
      app.delete(app.findCollectionByNameOrId('account_members'))
    } catch (e) {}
    try {
      app.delete(app.findCollectionByNameOrId('accounts'))
    } catch (e) {}
  },
)
