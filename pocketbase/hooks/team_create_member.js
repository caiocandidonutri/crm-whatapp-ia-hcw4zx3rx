routerAdd(
  'POST',
  '/backend/v1/team/create-member',
  (e) => {
    const body = e.requestInfo().body || {}
    const { name, email, password, role } = body

    if (!email || !password || password.length < 8) {
      return e.badRequestError('Email and password (min 8) are required.', {
        email: new ValidationError('validation_required', 'Email required'),
        password: new ValidationError('validation_length', 'Password min 8 chars'),
      })
    }

    const requesterId = e.auth.id
    let requesterMember = null
    try {
      requesterMember = $app.findFirstRecordByData('account_members', 'user_id', requesterId)
    } catch (err) {
      return e.forbiddenError('You do not belong to an account')
    }

    if (requesterMember.getString('role') !== 'owner') {
      return e.forbiddenError('Only owners can create members')
    }

    const accountId = requesterMember.getString('account_id')

    try {
      $app.findAuthRecordByEmail('users', email)
      return e.badRequestError('Email already exists', {
        email: new ValidationError('email_already_exists', 'E-mail já está em uso'),
      })
    } catch (err) {
      // Expected, email does not exist
    }

    let newUser = null
    const usersCol = $app.findCollectionByNameOrId('users')
    newUser = new Record(usersCol)
    newUser.set('name', name || '')
    newUser.setEmail(email)
    newUser.setPassword(password)
    newUser.setVerified(true)
    $app.save(newUser)

    // The on_user_signup hook might have automatically created a personal account.
    // Let's remove it and its associated member record before linking to the real account.
    try {
      const personalAccount = $app.findFirstRecordByData('accounts', 'owner_id', newUser.id)
      const personalMembers = $app.findRecordsByFilter(
        'account_members',
        'account_id = {:accId}',
        '',
        100,
        0,
        { accId: personalAccount.id },
      )

      for (const pm of personalMembers) {
        $app.delete(pm)
      }
      $app.delete(personalAccount)
    } catch (err) {
      // Ignored if not found
    }

    const membersCol = $app.findCollectionByNameOrId('account_members')
    const newMember = new Record(membersCol)
    newMember.set('account_id', accountId)
    newMember.set('user_id', newUser.id)
    newMember.set('role', role || 'member')
    newMember.set('joined_at', new Date().toISOString())
    $app.save(newMember)

    return e.json(200, {
      success: true,
      user_id: newUser.id,
    })
  },
  $apis.requireAuth(),
)
