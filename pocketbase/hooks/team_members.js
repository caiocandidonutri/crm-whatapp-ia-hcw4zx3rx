routerAdd(
  'GET',
  '/backend/v1/team/members',
  (e) => {
    const auth = e.auth

    let memberLink = null
    try {
      memberLink = $app.findFirstRecordByData('account_members', 'user_id', auth.id)
    } catch (err) {
      return e.notFoundError('User does not belong to any account.')
    }

    const accountId = memberLink.getString('account_id')
    const account = $app.findRecordById('accounts', accountId)

    const members = $app.findRecordsByFilter(
      'account_members',
      'account_id = {:accId}',
      '-created',
      1000,
      0,
      { accId: accountId },
    )

    const memberList = []
    for (const m of members) {
      let u = null
      try {
        u = $app.findRecordById('users', m.getString('user_id'))
      } catch (err) {}
      memberList.push({
        id: m.id,
        user_id: m.getString('user_id'),
        role: m.getString('role'),
        name: u ? u.getString('name') : '',
        email: u ? u.getString('email') : '',
        joined_at: m.getString('joined_at'),
      })
    }

    let invitesList = []
    try {
      const invites = $app.findRecordsByFilter(
        'account_invites',
        'account_id = {:accId}',
        '-created',
        1000,
        0,
        { accId: accountId },
      )
      for (const inv of invites) {
        invitesList.push({
          id: inv.id,
          email: inv.getString('email'),
          role: inv.getString('role'),
        })
      }
    } catch (err) {}

    return e.json(200, {
      account: {
        id: account.id,
        name: account.getString('name'),
        owner_id: account.getString('owner_id'),
      },
      members: memberList,
      invites: invitesList,
    })
  },
  $apis.requireAuth(),
)
