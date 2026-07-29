routerAdd(
  'POST',
  '/backend/v1/team/remove',
  (e) => {
    const auth = e.auth
    const body = e.requestInfo().body || {}
    const userId = body.user_id
    const inviteId = body.invite_id

    if (!userId && !inviteId) {
      return e.badRequestError('Must provide user_id or invite_id.')
    }

    let account = null
    try {
      account = $app.findFirstRecordByData('accounts', 'owner_id', auth.id)
    } catch (err) {
      return e.forbiddenError('Only account owners can remove members or invites.')
    }

    if (userId) {
      if (userId === auth.id) {
        return e.badRequestError('Owner cannot remove themselves.')
      }
      try {
        const member = $app.findFirstRecordByFilter(
          'account_members',
          'account_id = {:accId} && user_id = {:userId}',
          { accId: account.id, userId: userId },
        )
        if (member.getString('role') === 'owner') {
          return e.badRequestError('Cannot remove other owners.')
        }
        $app.delete(member)
        return e.json(200, { success: true })
      } catch (err) {
        return e.notFoundError('Member not found in this account.')
      }
    }

    if (inviteId) {
      try {
        const invite = $app.findFirstRecordByFilter(
          'account_invites',
          'account_id = {:accId} && id = {:inviteId}',
          { accId: account.id, inviteId: inviteId },
        )
        $app.delete(invite)
        return e.json(200, { success: true })
      } catch (err) {
        return e.notFoundError('Invite not found in this account.')
      }
    }
  },
  $apis.requireAuth(),
)
