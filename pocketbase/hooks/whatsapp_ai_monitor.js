onRecordAfterCreateSuccess((e) => {
  const msg = e.record

  if (msg.getBool('from_me')) return e.next()

  const remoteJid = msg.getString('remote_jid')
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return e.next()
  }

  const instanceName = msg.getString('instance_name')

  let contact = null
  try {
    contact = $app.findFirstRecordByFilter(
      'crm_contacts',
      'instance_name = {:inst} && jid = {:jid}',
      { inst: instanceName, jid: remoteJid },
    )
  } catch (_) {
    return e.next()
  }

  const updatedStr = contact.getString('updated')
  if (updatedStr) {
    const updatedTime = new Date(updatedStr).getTime()
    if (!isNaN(updatedTime) && Date.now() - updatedTime < 5 * 60 * 1000) {
      return e.next()
    }
  }

  let messages = []
  try {
    messages = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst}',
      '-timestamp',
      15,
      0,
      { jid: remoteJid, inst: instanceName },
    )
  } catch (_) {
    return e.next()
  }

  if (messages.length === 0) return e.next()

  const transcript = messages
    .slice()
    .reverse()
    .map(function (m) {
      const from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
      return from + ': ' + (m.getString('content') || '[mídia]')
    })
    .join('\n')

  const contactName =
    contact.getString('contact_name') || contact.getString('push_name') || remoteJid

  let aiResult = null
  try {
    const reply = $ai.chat({
      model: 'fast',
      messages: [
        {
          role: 'system',
          content:
            'Você é um assistente de CRM. Analise a conversa do WhatsApp e classifique o contato. ' +
            'Responda APENAS em JSON válido com os campos: ' +
            'stage (um de: lead, em_atendimento, cliente, nao_respondido), ' +
            'role (um de: paciente, nao_paciente), ' +
            'is_patient (boolean: true se o contato é paciente/cliente que fechou consulta), ' +
            'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta), ' +
            'suggested_action (breve próxima ação recomendada, max 120 chars), ' +
            'priority (número 1-10, onde 10 é urgente).',
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
    if (aiErr instanceof SkipAiConfigError) return e.next()
    $app.logger().error('ai_monitor: AI call failed', 'error', String(aiErr))
    return e.next()
  }

  if (!aiResult) return e.next()

  const validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
  if (aiResult.stage && validStages.indexOf(aiResult.stage) >= 0) {
    contact.set('stage', aiResult.stage)
  }

  if (aiResult.role === 'paciente' || aiResult.role === 'nao_paciente') {
    contact.set('role', aiResult.role)
  }

  const conversionDetected = aiResult.conversion_detected === true
  const isPatient = aiResult.is_patient === true

  if (conversionDetected || isPatient) {
    if (!contact.getBool('is_patient')) {
      contact.set('is_patient', true)
    }
    if (!contact.getString('converted_at')) {
      contact.set('converted_at', new Date().toISOString().split('T')[0])
    }
    if (conversionDetected) {
      contact.set('stage', 'cliente')
    }
  }

  if (aiResult.suggested_action) {
    contact.set('ai_suggested_action', String(aiResult.suggested_action).substring(0, 500))
  }

  if (aiResult.priority !== undefined) {
    const priority = Number(aiResult.priority)
    if (Number.isFinite(priority)) {
      contact.set('ai_priority', Math.min(Math.max(priority, 1), 10))
    }
  }

  try {
    $app.saveNoValidate(contact)
  } catch (saveErr) {
    $app.logger().error('ai_monitor: save failed', 'error', String(saveErr))
  }

  return e.next()
}, 'whatsapp_messages')
