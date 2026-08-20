routerAdd(
  'GET',
  '/backend/v1/integrations/vapid',
  (e) => {
    var auth = e.auth
    if (!auth) {
      return e.unauthorizedError('Autenticação necessária.')
    }

    // Verificar se o usuário é owner ou membro com permissão
    var memberLink = null
    try {
      memberLink = $app.findFirstRecordByData('account_members', 'user_id', auth.id)
    } catch (_) {
      return e.forbiddenError('Usuário não pertence a nenhuma conta.')
    }

    var role = memberLink.getString('role')
    var isOwner = role === 'owner'
    var accountId = memberLink.getString('account_id')

    var hasPublicKey = $secrets.has('VAPID_PUBLIC_KEY')
    var hasPrivateKey = $secrets.has('VAPID_PRIVATE_KEY')
    var hasContactEmail = $secrets.has('VAPID_CONTACT_EMAIL')

    var publicKey = ''
    var contactEmail = ''

    if (hasPublicKey) {
      publicKey = $secrets.get('VAPID_PUBLIC_KEY') || ''
    }
    if (hasContactEmail) {
      contactEmail = $secrets.get('VAPID_CONTACT_EMAIL') || ''
    }

    var isConnected = hasPublicKey && hasPrivateKey

    return e.json(200, {
      account_id: accountId,
      is_owner: isOwner,
      is_connected: isConnected,
      has_public_key: hasPublicKey,
      has_private_key: hasPrivateKey,
      public_key: publicKey,
      contact_email: contactEmail,
    })
  },
  $apis.requireAuth(),
)
