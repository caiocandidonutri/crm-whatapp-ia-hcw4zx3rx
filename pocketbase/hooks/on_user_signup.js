onRecordCreate((e) => {
  // Call e.next() to ensure the user record exists before creating relations
  e.next()

  const user = e.record
  const email = user.getString('email').toLowerCase()
  if (!email) return

  let invite = null
  try {
    invite = $app.findFirstRecordByData('account_invites', 'email', email)
  } catch (err) {}

  if (invite) {
    const membersCol = $app.findCollectionByNameOrId('account_members')
    const member = new Record(membersCol)
    member.set('account_id', invite.getString('account_id'))
    member.set('user_id', user.id)
    member.set('role', invite.getString('role'))
    member.set('joined_at', new Date().toISOString())

    $app.save(member)
    $app.delete(invite)
  } else {
    const name = user.getString('name') || email
    const accountsCol = $app.findCollectionByNameOrId('accounts')
    const account = new Record(accountsCol)
    account.set('name', 'Conta de ' + name)
    account.set('owner_id', user.id)

    $app.save(account)

    const membersCol = $app.findCollectionByNameOrId('account_members')
    const member = new Record(membersCol)
    member.set('account_id', account.id)
    member.set('user_id', user.id)
    member.set('role', 'owner')
    member.set('joined_at', new Date().toISOString())

    $app.save(member)
  }
}, 'users')
