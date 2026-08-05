routerAdd(
  'GET',
  '/backend/v1/crm/daily-summary',
  (e) => {
    const authId = e.auth.id

    let contacts = []
    try {
      contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'user_id = {:userId}',
        '-updated',
        500,
        0,
        { userId: authId },
      )
    } catch (_) {
      return e.json(200, { summary: 'Nenhum contato encontrado no CRM.' })
    }

    if (contacts.length === 0) {
      return e.json(200, { summary: 'Você ainda não tem contatos no CRM.' })
    }

    let leads = 0,
      emAtendimento = 0,
      clientes = 0,
      naoRespondidos = 0
    let pacientesNaoResp = 0,
      pacientesEmAtend = 0

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]
      const stage = c.getString('stage')
      const role = c.getString('role')

      if (stage === 'lead') leads++
      else if (stage === 'em_atendimento') {
        emAtendimento++
        if (role === 'paciente') pacientesEmAtend++
      } else if (stage === 'cliente') clientes++
      else if (stage === 'nao_respondido') {
        naoRespondidos++
        if (role === 'paciente') pacientesNaoResp++
      }
    }

    const statsText =
      'Leads: ' +
      leads +
      ', Em atendimento: ' +
      emAtendimento +
      ' (' +
      pacientesEmAtend +
      ' pacientes), Clientes: ' +
      clientes +
      ', Não respondidos: ' +
      naoRespondidos +
      ' (' +
      pacientesNaoResp +
      ' pacientes)'

    try {
      const aiRes = $ai.chat({
        model: 'fast',
        messages: [
          {
            role: 'system',
            content:
              'You are an assistant for Dr. Caio, a nutritionist. Generate a concise daily summary in Portuguese (max 1 sentence) based on the CRM stats. Be specific, actionable and encouraging. Example: "Você tem 5 leads esperando resposta, 2 pacientes precisam de retorno."',
          },
          { role: 'user', content: statsText },
        ],
        temperature: 0.5,
      })

      let summary = ''
      try {
        summary = aiRes.choices[0].message.content
      } catch (_) {}

      if (!summary) {
        summary =
          'Você tem ' +
          leads +
          ' leads, ' +
          emAtendimento +
          ' em atendimento' +
          (naoRespondidos > 0 ? ', ' + naoRespondidos + ' não respondidos' : '') +
          '.'
      }

      return e.json(200, { summary: summary })
    } catch (err) {
      const fallback =
        'Você tem ' +
        leads +
        ' leads, ' +
        emAtendimento +
        ' em atendimento' +
        (naoRespondidos > 0 ? ', ' + naoRespondidos + ' não respondidos' : '') +
        '.'
      return e.json(200, { summary: fallback })
    }
  },
  $apis.requireAuth(),
)
