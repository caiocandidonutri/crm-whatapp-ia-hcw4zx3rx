routerAdd(
  'POST',
  '/backend/v1/team/leave',
  (e) => {
    const auth = e.auth

    let member = null
    try {
      member = $app.findFirstRecordByData('account_members', 'user_id', auth.id)
    } catch (err) {
      return e.notFoundError('User does not belong to any account.')
    }

    if (member.getString('role') === 'owner') {
      return e.badRequestError('Owners cannot leave the account via this endpoint.')
    }

    $app.delete(member)

    return e.json(200, { success: true })
  },
  $apis.requireAuth(),
)
