migrate(
  (app) => {
    // 7) Reclassificação do funil: contatos com is_patient=true parados no estágio "lead"
    // são movidos para o estágio correto do funil vivo ("cliente").
    // Preserva staff/equipe da clínica como não-paciente.
    let contacts = []
    try {
      contacts = app.findRecordsByFilter(
        'crm_contacts',
        'is_patient = true && stage = "lead"',
        'created',
        500,
        0,
      )
    } catch (e) {
      console.log('[0140] Erro ao buscar contatos para reclassificação: ' + e)
    }

    let reclassifiedCount = 0
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]
      const phone = (c.getString('phone') || '').replace(/\D/g, '')
      const jid = (c.getString('jid') || '').replace(/\D/g, '')
      const name = (c.getString('contact_name') || '').toLowerCase()
      const role = c.getString('role') || ''

      const isStaff =
        role === 'nao_paciente' ||
        phone.indexOf('553599288027') >= 0 ||
        jid.indexOf('553599288027') >= 0 ||
        phone.indexOf('553599334379') >= 0 ||
        jid.indexOf('553599334379') >= 0 ||
        name.indexOf('dr. caio') >= 0 ||
        name.indexOf('secretaria') >= 0

      if (isStaff) {
        c.set('is_patient', false)
        c.set('role', 'nao_paciente')
      } else {
        c.set('stage', 'cliente')
        c.set('role', 'paciente')
        if (!c.getString('converted_at')) {
          c.set('converted_at', new Date().toISOString().split('T')[0])
        }
      }

      app.saveNoValidate(c)
      reclassifiedCount++
    }

    console.log(
      '[0140] Contatos com is_patient=true reclassificados de "lead" para "cliente": ' +
        reclassifiedCount,
    )
  },
  (app) => {
    // Reversão no-op
  },
)
