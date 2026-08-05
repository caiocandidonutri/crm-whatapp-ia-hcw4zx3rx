routerAdd(
  'POST',
  '/backend/v1/crm/import-conversations',
  (e) => {
    const authId = e.auth.id

    let accountId = ''
    try {
      const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
        userId: authId,
      })
      accountId = member.getString('account_id')
    } catch (_) {}

    let conversations = []
    try {
      conversations = $app.findRecordsByFilter(
        'conversations',
        'user_id = {:userId} && is_group = false',
        '-updated',
        70,
        0,
        { userId: authId },
      )
    } catch (_) {
      return e.json(200, { total: 0, created: 0, classified: 0, skipped: 0, errors: 0 })
    }

    const openaiKey = $secrets.get('OPENAI_API_KEY')

    let created = 0
    let classified = 0
    let skipped = 0
    let errors = 0

    const systemPrompt =
      'Voce e um classificador de CRM para conversas de WhatsApp do Dr. Caio (nutricionista).\n' +
      'Analise a conversa abaixo e classifique o contato.\n\n' +
      'Contexto: O Dr. Caio e um nutricionista que atende pacientes. As conversas podem ser sobre:\n' +
      '- Agendamento de consultas\n' +
      '- Duvidas sobre cuidados nutricionais\n' +
      '- Retornos de pacientes existentes\n' +
      '- Pessoas interessadas em conhecer o trabalho do Dr. Caio\n\n' +
      'Retorne APENAS um objeto JSON valido (sem texto adicional) com:\n' +
      '- "stage": uma de "lead", "em_atendimento", "cliente", "nao_respondido"\n' +
      '  - "lead": contato inicial, querendo conhecer o Dr. Caio, sem conversa significativa ainda\n' +
      '  - "em_atendimento": conversa ativa, sendo atendido ou em negociacao de consulta\n' +
      '  - "cliente": consulta confirmada ou agendada, paciente que ja fechou\n' +
      '  - "nao_respondido": contato parou de responder\n' +
      '- "role": "paciente" ou "nao_paciente"\n' +
      '  - "paciente": ja e paciente do Dr. Caio ou esta em processo de se tornar\n' +
      '  - "nao_paciente": nao e paciente (ex: vendedor, contato pessoal, etc)\n\n' +
      'Exemplo: {"stage":"em_atendimento","role":"paciente"}'

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i]
      const remoteJid = conv.getString('remote_jid')
      const instanceName = conv.getString('instance_name')
      const contactName = conv.getString('contact_name') || ''
      const avatarUrl = conv.getString('avatar_url') || ''
      const phone = conv.getString('contact_phone') || remoteJid.split('@')[0]

      let contact = null
      try {
        contact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:instance} && jid = {:jid}',
          { instance: instanceName, jid: remoteJid },
        )
      } catch (_) {}

      if (!contact) {
        try {
          const contactCol = $app.findCollectionByNameOrId('crm_contacts')
          contact = new Record(contactCol)
          contact.set('user_id', authId)
          if (accountId) contact.set('account_id', accountId)
          contact.set('instance_name', instanceName)
          contact.set('jid', remoteJid)
          contact.set('phone', phone)
          contact.set('push_name', contactName)
          contact.set('contact_name', contactName || '')
          contact.set('avatar_url', avatarUrl)
          contact.set('stage', 'lead')
          contact.set('role', '')
          $app.save(contact)
          created++
        } catch (err) {
          errors++
          continue
        }
      }

      let messages = []
      try {
        messages = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:instance}',
          '-timestamp',
          10,
          0,
          { jid: remoteJid, instance: instanceName },
        )
      } catch (_) {
        skipped++
        continue
      }

      if (messages.length === 0) {
        skipped++
        continue
      }

      if (!openaiKey) {
        skipped++
        continue
      }

      var sorted = messages.slice().reverse()
      var transcript = ''
      for (var j = 0; j < sorted.length; j++) {
        var m = sorted[j]
        var fromMe = m.getBool('from_me')
        var content = m.getString('content') || '[midia]'
        var sender = fromMe ? 'Atendente' : m.getString('push_name') || 'Contato'
        transcript += sender + ': ' + content + '\n'
      }

      var openaiRes
      try {
        openaiRes = $http.send({
          url: 'https://api.openai.com/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + openaiKey,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            temperature: 0,
            max_tokens: 100,
          }),
          timeout: 30,
        })
      } catch (err) {
        errors++
        continue
      }

      if (openaiRes.statusCode !== 200) {
        errors++
        continue
      }

      var contentText = ''
      try {
        contentText = openaiRes.json.choices[0].message.content
      } catch (_) {
        errors++
        continue
      }

      var classification = null
      try {
        classification = JSON.parse(contentText)
      } catch (_) {
        var match = contentText.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            classification = JSON.parse(match[0])
          } catch (_) {}
        }
      }

      if (!classification) {
        errors++
        continue
      }

      var validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
      var newStage = validStages.indexOf(classification.stage) >= 0 ? classification.stage : null
      var newRole =
        classification.role === 'paciente' || classification.role === 'nao_paciente'
          ? classification.role
          : null

      if (newStage || newRole) {
        try {
          var contactRecord = $app.findRecordById('crm_contacts', contact.id)
          if (newStage) contactRecord.set('stage', newStage)
          if (newRole) contactRecord.set('role', newRole)
          $app.save(contactRecord)
          classified++
        } catch (err) {
          errors++
        }
      } else {
        skipped++
      }
    }

    return e.json(200, {
      total: conversations.length,
      created: created,
      classified: classified,
      skipped: skipped,
      errors: errors,
    })
  },
  $apis.requireAuth(),
)
