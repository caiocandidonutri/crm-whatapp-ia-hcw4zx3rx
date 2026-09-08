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

  function formatMessageContent(m) {
    const content = m.getString('content')
    if (content && content.trim()) return content.trim()
    const transcription = m.getString('transcription')
    if (transcription && transcription.trim()) {
      return '[áudio transcrito: ' + transcription.trim() + ']'
    }
    const msgType = m.getString('message_type') || ''
    if (msgType === 'audioMessage' || msgType === 'audio' || msgType === 'ptt') {
      return '[áudio de voz]'
    }
    return '[mídia]'
  }

  const transcript = messages
    .slice()
    .reverse()
    .map(function (m) {
      const from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
      return from + ': ' + formatMessageContent(m)
    })
    .join('\n')

  const contactName =
    contact.getString('contact_name') || contact.getString('push_name') || remoteJid

  // Regras de follow-up lidas do banco
  let rulesDesc = 'Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d)'
  try {
    const rules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 50, 0)
    const lines = []
    for (let r = 0; r < rules.length; r++) {
      const nm = rules[r].getString('name')
      const ds = rules[r].getInt('followup_days') || 10
      if (nm) lines.push(nm + ' (' + ds + 'd)')
    }
    if (lines.length > 0) rulesDesc = lines.join(', ')
  } catch (_) {}

  // Contexto do paciente
  const pStage = contact.getString('stage') || 'lead'
  const pCare = contact.getString('care_status') || 'em_dia'
  let activeTasksCount = 0
  try {
    const tks = $app.findRecordsByFilter(
      'tasks',
      "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
      '-created',
      5,
      0,
      { cid: contact.id },
    )
    activeTasksCount = tks ? tks.length : 0
  } catch (_) {}

  let aiResult = null
  try {
    const systemPromptCare =
      'Você é o assistente de inteligência clínica e CRM da clínica de nutrição do Dr. Caio Cândido.\n' +
      'Papéis fundamentais da clínica:\n' +
      '- "Dr. Caio" / "Dr. Caio Cândido" é o nutricionista responsável pelas consultas e condutas nutricionais.\n' +
      '- "Fabiana" é a assistente/secretária de acolhimento e agendamento.\n' +
      '- Dr. Caio e Fabiana NUNCA devem ser interpretados como pacientes. O paciente é o interlocutor externo na conversa.\n' +
      'Regras de Follow-up lidas da clínica: ' +
      rulesDesc +
      '.\n' +
      'Vocabulário nutricional/clínico relevante: SOP (Síndrome dos Ovários Policísticos), plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica, sintomas e exames.\n\n' +
      'Responda APENAS em JSON válido com os campos:\n' +
      'stage (um de: lead, em_atendimento, cliente, nao_respondido),\n' +
      'role (um de: paciente, nao_paciente),\n' +
      'is_patient (boolean: true se é paciente ou agendou consulta com Dr. Caio),\n' +
      'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta),\n' +
      'suggested_action (próxima ação clínica/atendimento sugerida, max 120 chars),\n' +
      'priority (número de 1 a 10, onde 10 é mais urgente).'

    const userPromptCare =
      'Paciente/Contato: ' +
      contactName +
      '\n' +
      'Estágio do pipeline (stage): ' +
      pStage +
      '\n' +
      'Status de cuidado (care_status): ' +
      pCare +
      '\n' +
      'Tarefas de cuidado ativas: ' +
      activeTasksCount +
      '\n\n' +
      'Histórico da Conversa:\n' +
      transcript

    const reply = $ai.chat({
      model: 'fast',
      messages: [
        {
          role: 'system',
          content: systemPromptCare,
        },
        {
          role: 'user',
          content: userPromptCare,
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
