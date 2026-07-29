migrate(
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
    const newRule =
      "@request.auth.id != '' && account_id.account_members_via_account_id.user_id ?= @request.auth.id"

    for (const name of collectionsToUpdate) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = newRule
        col.viewRule = newRule
        col.createRule = newRule
        col.updateRule = newRule
        col.deleteRule = newRule
        app.save(col)
      } catch (err) {
        console.log('Failed to update ' + name + ': ' + err)
      }
    }

    try {
      const acc = app.findCollectionByNameOrId('accounts')
      acc.listRule =
        "@request.auth.id != '' && account_members_via_account_id.user_id ?= @request.auth.id"
      acc.viewRule =
        "@request.auth.id != '' && account_members_via_account_id.user_id ?= @request.auth.id"
      acc.updateRule = "@request.auth.id != '' && owner_id = @request.auth.id"
      acc.createRule = null
      acc.deleteRule = null
      app.save(acc)
    } catch (e) {}

    try {
      const members = app.findCollectionByNameOrId('account_members')
      members.listRule =
        "@request.auth.id != '' && (user_id = @request.auth.id || account_id.account_members_via_account_id.user_id ?= @request.auth.id)"
      members.viewRule =
        "@request.auth.id != '' && (user_id = @request.auth.id || account_id.account_members_via_account_id.user_id ?= @request.auth.id)"
      members.createRule = null
      members.updateRule = null
      members.deleteRule = null
      app.save(members)
    } catch (e) {}

    try {
      const invites = app.findCollectionByNameOrId('account_invites')
      invites.listRule = "@request.auth.id != '' && account_id.owner_id = @request.auth.id"
      invites.viewRule = "@request.auth.id != '' && account_id.owner_id = @request.auth.id"
      invites.createRule = null
      invites.updateRule = null
      invites.deleteRule = null
      app.save(invites)
    } catch (e) {}
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
    const oldRule = "@request.auth.id != '' && user_id = @request.auth.id"

    for (const name of collectionsToUpdate) {
      try {
        const col = app.findCollectionByNameOrId(name)
        col.listRule = oldRule
        col.viewRule = oldRule
        col.createRule = oldRule
        col.updateRule = oldRule
        col.deleteRule = oldRule
        app.save(col)
      } catch (err) {}
    }

    try {
      const acc = app.findCollectionByNameOrId('accounts')
      acc.listRule = "@request.auth.id != ''"
      acc.viewRule = "@request.auth.id != ''"
      acc.updateRule = "@request.auth.id != ''"
      acc.createRule = "@request.auth.id != ''"
      acc.deleteRule = "@request.auth.id != ''"
      app.save(acc)
    } catch (e) {}

    try {
      const members = app.findCollectionByNameOrId('account_members')
      members.listRule = "@request.auth.id != ''"
      members.viewRule = "@request.auth.id != ''"
      members.createRule = "@request.auth.id != ''"
      members.updateRule = "@request.auth.id != ''"
      members.deleteRule = "@request.auth.id != ''"
      app.save(members)
    } catch (e) {}

    try {
      const invites = app.findCollectionByNameOrId('account_invites')
      invites.listRule = "@request.auth.id != ''"
      invites.viewRule = "@request.auth.id != ''"
      invites.createRule = "@request.auth.id != ''"
      invites.updateRule = "@request.auth.id != ''"
      invites.deleteRule = "@request.auth.id != ''"
      app.save(invites)
    } catch (e) {}
  },
)
