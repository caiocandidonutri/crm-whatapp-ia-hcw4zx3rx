routerAdd(
  'POST',
  '/backend/v1/crm/add-from-chat',
  (e) => {
    const body = e.requestInfo().body
    if (!body.instance_name || !body.jid) {
      return e.badRequestError('instance_name e jid são obrigatórios')
    }

    const authId = e.auth.id

    try {
      const existing = $app.findFirstRecordByFilter(
        'crm_contacts',
        'user_id = {:userId} && instance_name = {:instanceName} && jid = {:jid}',
        { userId: authId, instanceName: body.instance_name, jid: body.jid },
      )
      return e.json(200, { record: existing, isAlreadyAdded: true })
    } catch (_) {
      // Record não existe, prossegue criando.
    }

    // Carrega dados da conversation pra usar como base. Tudo que vier no
    // body (vindo do dialog de pré-validação) sobrescreve o que veio da
    // conv — assim o user pode revisar/editar antes de salvar.
    let avatarUrl = ''
    let convContactName = ''
    let phone = body.jid.split('@')[0]

    try {
      const conv = $app.findFirstRecordByFilter(
        'conversations',
        'user_id = {:userId} && instance_name = {:instanceName} && remote_jid = {:jid}',
        { userId: authId, instanceName: body.instance_name, jid: body.jid },
      )
      avatarUrl = conv.getString('avatar_url') || ''
      convContactName = conv.getString('contact_name') || ''
      if (conv.getString('contact_phone')) {
        phone = conv.getString('contact_phone')
      }
    } catch (_) {}

    // Stages permitidos — defesa contra valores arbitrários no body.
    const allowedStages = ['lead', 'em_atendimento', 'cliente', 'perdido']
    const stage = allowedStages.indexOf(body.stage) >= 0 ? body.stage : 'lead'

    // contact_name: prioriza o que veio do dialog, cai pro da conv.
    const finalContactName =
      typeof body.contact_name === 'string' && body.contact_name.trim()
        ? body.contact_name.trim().substring(0, 200)
        : convContactName

    // push_name: preserva o nome WhatsApp original (= contact_name da conv
    // antes de qualquer override manual). Antes ficava sempre vazio.
    const pushName = convContactName

    let accountId = ''
    try {
      const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
        userId: authId,
      })
      accountId = member.getString('account_id')
    } catch (_) {}

    const collection = $app.findCollectionByNameOrId('crm_contacts')
    const record = new Record(collection)
    record.set('user_id', authId)
    if (accountId) record.set('account_id', accountId)
    record.set('instance_name', body.instance_name)
    record.set('jid', body.jid)
    record.set('phone', phone)
    record.set('push_name', pushName)
    record.set('contact_name', finalContactName)
    record.set('avatar_url', avatarUrl)
    record.set('stage', stage)

    // Campos opcionais novos (vindos do dialog de pré-validação ou ausentes
    // pra adicionar rápido sem dialog).
    if (typeof body.company_id === 'string' && body.company_id) {
      // Validar que a empresa pertence ao mesmo user antes de vincular.
      try {
        const company = $app.findRecordById('crm_companies', body.company_id)
        if (company.getString('user_id') === authId) {
          record.set('company_id', body.company_id)
        }
      } catch (_) {}
    }
    if (typeof body.role === 'string' && body.role.trim()) {
      record.set('role', body.role.trim().substring(0, 100))
    }
    if (typeof body.email === 'string' && body.email.trim()) {
      record.set('email', body.email.trim().substring(0, 200))
    }

    if (typeof body.assigned_to === 'string' && body.assigned_to && accountId) {
      try {
        $app.findFirstRecordByFilter(
          'account_members',
          'account_id = {:accountId} && user_id = {:assignedTo}',
          { accountId: accountId, assignedTo: body.assigned_to },
        )
        record.set('assigned_to', body.assigned_to)
      } catch (_) {}
    }

    if (Array.isArray(body.category_ids)) {
      record.set('category_ids', body.category_ids)
    }

    $app.save(record)

    return e.json(200, { record: record, isAlreadyAdded: false })
  },
  $apis.requireAuth(),
)
