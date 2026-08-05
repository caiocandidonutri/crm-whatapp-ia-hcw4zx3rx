routerAdd(
  'POST',
  '/backend/v1/whatsapp/crm-classify/{conversationId}',
  (e) => {
    try {
      const conversationId = e.request.pathValue('conversationId')
      if (!conversationId) return e.badRequestError('conversationId is required')

      const userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      let conversation
      try {
        conversation = $app.findRecordById('conversations', conversationId)
      } catch (err) {
        return e.notFoundError('conversation not found')
      }

      const instanceName = conversation.getString('instance_name')
      const remoteJid = conversation.getString('remote_jid')
      const contactName = conversation.getString('contact_name') || remoteJid

      let messages = []
      try {
        messages = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst}',
          '-timestamp',
          20,
          0,
          { jid: remoteJid, inst: instanceName },
        )
      } catch (err) {
        $app.logger().error('crm-classify: failed to load messages', 'error', String(err))
      }

      if (messages.length === 0) {
        return e.json(200, { classified: false, reason: 'no_messages' })
      }

      const transcript = messages
        .slice(0, 15)
        .reverse()
        .map(function (m) {
          const from = m.getBoolean('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
          return from + ': ' + m.getString('content')
        })
        .join('\n')

      let aiResult = null
      try {
        const reply = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente de CRM. Analise a conversa do WhatsApp e classifique o contato. Responda APENAS em JSON válido com os campos: stage (um de: lead, em_atendimento, cliente, nao_respondido), priority (um de: baixa, media, alta, urgente), suggested_action (breve próxima ação recomendada, max 120 chars).',
            },
            {
              role: 'user',
              content: 'Contato: ' + contactName + '\n\nTranscrição:\n' + transcript,
            },
          ],
        })

        const rawText =
          reply.choices &&
          reply.choices[0] &&
          reply.choices[0].message &&
          reply.choices[0].message.content
        if (rawText) {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0])
          }
        }
      } catch (aiErr) {
        if (aiErr instanceof SkipAiConfigError) {
          return e.json(503, { error: 'AI temporarily unavailable' })
        }
        $app.logger().error('crm-classify: AI call failed', 'error', String(aiErr))
        return e.json(200, { classified: false, reason: 'ai_error' })
      }

      if (!aiResult) {
        return e.json(200, { classified: false, reason: 'parse_failed' })
      }

      let crmContact = null
      try {
        crmContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'jid = {:jid} && instance_name = {:inst}',
          { jid: remoteJid, inst: instanceName },
        )
      } catch (err) {
        // no existing contact
      }

      if (crmContact) {
        if (aiResult.stage) crmContact.set('stage', aiResult.stage)
        if (aiResult.suggested_action)
          crmContact.set('ai_suggested_action', aiResult.suggested_action)
        if (aiResult.priority) crmContact.set('ai_priority', aiResult.priority)
        $app.saveNoValidate(crmContact)
      } else {
        try {
          const col = $app.findCollectionByNameOrId('crm_contacts')
          crmContact = new Record(col)
          crmContact.set('user_id', userId)
          crmContact.set('instance_name', instanceName)
          crmContact.set('jid', remoteJid)
          crmContact.set('phone', conversation.getString('contact_phone') || '')
          crmContact.set('push_name', contactName)
          crmContact.set('contact_name', contactName)
          if (aiResult.stage) crmContact.set('stage', aiResult.stage)
          if (aiResult.suggested_action)
            crmContact.set('ai_suggested_action', aiResult.suggested_action)
          if (aiResult.priority) crmContact.set('ai_priority', aiResult.priority)
          crmContact.set('account_id', conversation.getString('account_id'))
          $app.saveNoValidate(crmContact)
        } catch (createErr) {
          $app.logger().error('crm-classify: failed to create contact', 'error', String(createErr))
        }
      }

      return e.json(200, {
        classified: true,
        conversation_id: conversationId,
        contact_id: crmContact ? crmContact.id : null,
        classification: aiResult,
      })
    } catch (err) {
      $app.logger().error('crm-classify: unexpected error', 'error', String(err))
      return e.json(500, { error: 'classification failed' })
    }
  },
  $apis.requireAuth(),
)
