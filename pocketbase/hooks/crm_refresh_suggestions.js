routerAdd(
  'POST',
  '/backend/v1/crm/refresh-suggestions',
  (e) => {
    try {
      const userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      let accountId = ''
      try {
        accountId = e.auth.get('account_id') || ''
      } catch (_) {}

      let contacts = []
      try {
        if (accountId) {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'account_id = {:accountId}',
            '-updated',
            200,
            0,
            { accountId: accountId },
          )
        } else {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'user_id = {:userId}',
            '-updated',
            200,
            0,
            { userId: userId },
          )
        }
      } catch (_) {
        return e.json(200, { total: 0, updated: 0, errors: 0 })
      }

      let updated = 0
      let errors = 0

      var systemPrompt =
        'Voce e um assistente de CRM. Analise o contato e as mensagens recentes. Responda em JSON com: { "suggested_action": string (proxima acao recomendada, max 200 chars), "priority": number (1-5, onde 5 e urgente) }. Responda apenas o JSON.'

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i]
        const contactId = contact.id

        try {
          const contactName =
            contact.getString('contact_name') || contact.getString('push_name') || 'Contato'
          const phone = contact.getString('phone') || ''
          const stage = contact.getString('stage') || ''
          const notes = contact.getString('notes') || ''

          var messages = []
          try {
            var conversations = $app.findRecordsByFilter(
              'conversations',
              'contact_phone = {:phone}',
              '-created',
              5,
              0,
              phone,
            )
            if (conversations.length > 0) {
              var conv = conversations[0]
              var recentMsgs = $app.findRecordsByFilter(
                'whatsapp_messages',
                'remote_jid = {:jid}',
                '-timestamp',
                10,
                0,
                conv.getString('remote_jid'),
              )
              for (var j = 0; j < recentMsgs.length; j++) {
                var m = recentMsgs[j]
                var content = m.getString('content')
                if (content) {
                  messages.push(
                    m.getBool('from_me') ? 'Atendente: ' + content : 'Cliente: ' + content,
                  )
                }
              }
            }
          } catch (_) {}

          var contextParts = [
            'Nome: ' + contactName,
            phone ? 'Telefone: ' + phone : '',
            stage ? 'Estagio: ' + stage : '',
            notes ? 'Notas: ' + notes : '',
            messages.length > 0 ? 'Mensagens recentes:\n' + messages.join('\n') : '',
          ].filter(Boolean)

          var reply = $ai.chat({
            model: 'fast',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: contextParts.join('\n') },
            ],
          })

          var text = reply.choices[0].message.content.trim()
          var parsed
          try {
            var jsonMatch = text.match(/\{[\s\S]*\}/)
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text)
          } catch (_) {
            parsed = { suggested_action: text.substring(0, 200), priority: 3 }
          }

          var contactRecord = $app.findRecordById('crm_contacts', contactId)
          contactRecord.set(
            'ai_suggested_action',
            String(parsed.suggested_action || '').substring(0, 200),
          )
          var priority = Number(parsed.priority)
          contactRecord.set(
            'ai_priority',
            Number.isFinite(priority) ? Math.min(Math.max(priority, 1), 5) : 3,
          )
          $app.save(contactRecord)
          updated++
        } catch (err) {
          errors++
        }
      }

      return e.json(200, {
        total: contacts.length,
        updated: updated,
        errors: errors,
      })
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'AI temporariamente indisponivel' })
      }
      if (err instanceof SkipAiError) {
        var status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'AI temporariamente indisponivel' : err.message,
        })
      }
      throw err
    }
  },
  $apis.requireAuth(),
)
