routerAdd(
  'POST',
  '/backend/v1/crm/ai-suggestion',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const userId = e.auth?.id
      if (!userId) return e.unauthorizedError('auth required')

      const contactId = body.contact_id
      if (!contactId) return e.badRequestError('contact_id is required')

      let contact
      try {
        contact = $app.findRecordById('crm_contacts', contactId)
      } catch (_) {
        return e.notFoundError('contact not found')
      }

      const contactName =
        contact.getString('contact_name') || contact.getString('push_name') || 'Contato'
      const phone = contact.getString('phone') || ''
      const stage = contact.getString('stage') || ''
      const notes = contact.getString('notes') || ''

      const messages = []
      try {
        const convFilter = 'remote_jid != "" && account_id != ""'
        const conversations = $app.findRecordsByFilter(
          'conversations',
          'contact_phone = {:phone}',
          '-created',
          5,
          0,
          phone,
        )
        if (conversations.length > 0) {
          const conv = conversations[0]
          const recentMsgs = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid}',
            '-timestamp',
            10,
            0,
            conv.getString('remote_jid'),
          )
          for (const m of recentMsgs) {
            const content = m.getString('content')
            if (content) {
              messages.push(m.getBool('from_me') ? 'Atendente: ' + content : 'Cliente: ' + content)
            }
          }
        }
      } catch (_) {}

      const contextParts = [
        'Nome: ' + contactName,
        phone ? 'Telefone: ' + phone : '',
        stage ? 'Estagio: ' + stage : '',
        notes ? 'Notas: ' + notes : '',
        messages.length > 0 ? 'Mensagens recentes:\n' + messages.join('\n') : '',
      ].filter(Boolean)

      const systemPrompt =
        'Voce e um assistente de CRM. Analise o contato e as mensagens recentes. Responda em JSON com: { "suggested_action": string (proxima acao recomendada, max 200 chars), "priority": number (1-5, onde 5 e urgente) }. Responda apenas o JSON.'

      const reply = $ai.chat({
        model: 'fast',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextParts.join('\n') },
        ],
      })

      const text = reply.choices[0].message.content.trim()
      let parsed
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text)
      } catch (_) {
        parsed = { suggested_action: text.substring(0, 200), priority: 3 }
      }

      contact.set('ai_suggested_action', String(parsed.suggested_action || '').substring(0, 200))
      const priority = Number(parsed.priority)
      contact.set('ai_priority', Number.isFinite(priority) ? Math.min(Math.max(priority, 1), 5) : 3)
      $app.save(contact)

      return e.json(200, {
        contact_id: contactId,
        suggested_action: parsed.suggested_action || '',
        priority: parsed.priority || 3,
      })
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'AI temporariamente indisponivel' })
      }
      if (err instanceof SkipAiError) {
        const status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'AI temporariamente indisponivel' : err.message,
        })
      }
      throw err
    }
  },
  $apis.requireAuth(),
)
