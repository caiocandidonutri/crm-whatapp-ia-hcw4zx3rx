routerAdd(
  'POST',
  '/backend/v1/team/invite',
  (e) => {
    const auth = e.auth
    const body = e.requestInfo().body || {}
    let email = body.email
    let role = body.role || 'member'

    if (!email) {
      return e.badRequestError('Email is required.')
    }
    email = email.toLowerCase()

    if (role !== 'owner' && role !== 'member') {
      role = 'member'
    }

    let account = null
    try {
      account = $app.findFirstRecordByData('accounts', 'owner_id', auth.id)
    } catch (err) {
      return e.forbiddenError('Only account owners can invite members.')
    }

    try {
      const targetUser = $app.findAuthRecordByEmail('users', email)
      try {
        $app.findFirstRecordByFilter(
          'account_members',
          'account_id = {:accId} && user_id = {:userId}',
          { accId: account.id, userId: targetUser.id },
        )
        return e.badRequestError('User is already a member.')
      } catch (err) {}
    } catch (err) {}

    try {
      $app.findFirstRecordByFilter('account_invites', 'account_id = {:accId} && email = {:email}', {
        accId: account.id,
        email: email,
      })
      return e.badRequestError('User is already invited.')
    } catch (err) {}

    const invitesCol = $app.findCollectionByNameOrId('account_invites')
    const invite = new Record(invitesCol)
    invite.set('account_id', account.id)
    invite.set('email', email)
    invite.set('role', role)
    invite.set('invited_by', auth.id)

    $app.save(invite)

    return e.json(200, { success: true, invite })
  },
  $apis.requireAuth(),
)
