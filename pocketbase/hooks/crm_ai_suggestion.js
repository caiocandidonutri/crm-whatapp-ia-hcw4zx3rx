routerAdd(
  'POST',
  '/backend/v1/crm/refresh-suggestions',
  (e) => {
    const authId = e.auth.id

    let contacts = []
    try {
      contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'user_id = {:userId}',
        '-updated',
        100,
        0,
        { userId: authId },
      )
    } catch (_) {
      return e.json(200, { total: 0, updated: 0, errors: 0 })
    }

    let updated = 0
    let errors = 0

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]
      const remoteJid = contact.getString('remote_jid')
      const instanceName = contact.getString('instance_name')
      const stage = contact.getString('stage')
      const role = contact.getString('role')

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
        errors++
        continue
      }

      if (messages.length === 0) {
        try {
          const record = $app.findRecordById('crm_contacts', contact.id)
          record.set('ai_suggested_action', 'Sem mensagens recentes')
          record.set('ai_priority', 0)
          $app.save(record)
          updated++
        } catch (_) {
          errors++
        }
        continue
      }

      let transcript = ''
      const sorted = messages.slice().reverse()
      for (let j = 0; j < sorted.length; j++) {
        const content = sorted[j].getString('content') || ''
        if (!content) continue
        const fromMe = sorted[j].getBool('from_me')
        const sender = fromMe ? 'Atendente' : sorted[j].getString('push_name') || 'Contato'
        transcript += sender + ': ' + content + '\n'
      }

      if (!transcript.trim()) {
        errors++
        continue
      }

      const systemPrompt =
        'You are an AI assistant for Dr. Caio, a nutritionist. Based on the conversation and contact info below, suggest the next best action and a priority score (1-10, where 10 is most urgent).\n\n' +
        'Context: Dr. Caio is a nutritionist who sees patients. Conversations may be about appointment scheduling, nutritional questions, follow-ups, etc.\n\n' +
        'Return ONLY a JSON object: {"action": "short action in Portuguese", "priority": number}\n\n' +
        'Examples:\n{"action":"Seguir contato","priority":5}\n{"action":"Confirmar consulta","priority":8}\n{"action":"Agendar retorno","priority":7}'

      let aiRes
      try {
        aiRes = $ai.chat({
          model: 'fast',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: 'Stage: ' + stage + '\nRole: ' + role + '\n\nTranscript:\n' + transcript,
            },
          ],
          temperature: 0,
        })
      } catch (err) {
        errors++
        continue
      }

      let contentText = ''
      try {
        contentText = aiRes.choices[0].message.content
      } catch (_) {
        errors++
        continue
      }

      let suggestion = null
      try {
        suggestion = JSON.parse(contentText)
      } catch (_) {
        const match = contentText.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            suggestion = JSON.parse(match[0])
          } catch (_) {}
        }
      }

      if (!suggestion) {
        errors++
        continue
      }

      try {
        const record = $app.findRecordById('crm_contacts', contact.id)
        record.set('ai_suggested_action', suggestion.action || '')
        record.set('ai_priority', Math.min(Math.max(parseInt(suggestion.priority) || 5, 1), 10))
        $app.save(record)
        updated++
      } catch (_) {
        errors++
      }
    }

    return e.json(200, { total: contacts.length, updated: updated, errors: errors })
  },
  $apis.requireAuth(),
)
