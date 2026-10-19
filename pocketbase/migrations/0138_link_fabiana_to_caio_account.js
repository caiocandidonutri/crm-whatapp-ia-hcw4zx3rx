migrate(
  (app) => {
    // 4) Vínculo de acesso: incluir a usuária "Fabiana" como member da conta da clínica
    // "Dr. Caio Clínica" (id u2cbx6yw2gm0ook), sem alterar a visualização atual.
    const targetAccountId = 'u2cbx6yw2gm0ook'
    let fabianaUser = null

    try {
      fabianaUser = app.findFirstRecordByFilter(
        'users',
        'name ~ "Fabiana" || email = "caiogestaoclinica@gmail.com"',
      )
    } catch (_) {}

    if (!fabianaUser) {
      console.log('[0138] Usuária Fabiana não encontrada, pulando vínculo.')
      return
    }

    const fabianaId = fabianaUser.id

    // Verificar se já existe vínculo
    let existingMember = null
    try {
      existingMember = app.findFirstRecordByFilter(
        'account_members',
        'account_id = {:aid} && user_id = {:uid}',
        { aid: targetAccountId, uid: fabianaId },
      )
    } catch (_) {}

    if (existingMember) {
      console.log('[0138] Vínculo de Fabiana na conta já existe: ' + existingMember.id)
      return
    }

    // Criar vínculo de member
    try {
      const membersCol = app.findCollectionByNameOrId('account_members')
      const newMember = new Record(membersCol)
      newMember.set('account_id', targetAccountId)
      newMember.set('user_id', fabianaId)
      newMember.set('role', 'member')
      newMember.set('joined_at', new Date().toISOString())
      app.save(newMember)
      console.log('[0138] Fabiana vinculada como member da conta ' + targetAccountId)
    } catch (err) {
      console.log('[0138] Erro ao criar vínculo de Fabiana: ' + err)
    }
  },
  (app) => {
    try {
      const fabianaUser = app.findFirstRecordByFilter(
        'users',
        'name ~ "Fabiana" || email = "caiogestaoclinica@gmail.com"',
      )
      if (fabianaUser) {
        const mem = app.findFirstRecordByFilter(
          'account_members',
          'account_id = "u2cbx6yw2gm0ook" && user_id = {:uid} && role = "member"',
          { uid: fabianaUser.id },
        )
        if (mem) app.delete(mem)
      }
    } catch (_) {}
  },
)
