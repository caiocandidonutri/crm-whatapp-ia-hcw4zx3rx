onRecordAfterCreateSuccess((e) => {
  const msg = e.record

  if (msg.getBool('from_me')) return e.next()

  const remoteJid = msg.getString('remote_jid')
  if (remoteJid.endsWith('@g.us')) return e.next()

  const instanceName = msg.getString('instance_name')
  const userId = msg.getString('user_id')
  const msgType = msg.getString('message_type')
  const isText = msgType === 'conversation' || msgType === 'extendedTextMessage'

  const nowTs = Math.floor(Date.now() / 1000)
  const msgTs = msg.getInt('timestamp') || 0
  const msgAge = msgTs > 0 ? nowTs - msgTs : 999999
  if (msgAge > 300) return e.next()

  let conv = null
  try {
    conv = $app.findFirstRecordByFilter(
      'conversations',
      'remote_jid = {:jid} && instance_name = {:instance}',
      { jid: remoteJid, instance: instanceName },
    )
  } catch (_) {}

  if (conv && conv.getBool('is_group')) return e.next()

  let accountId = msg.getString('account_id') || ''
  if (!accountId && conv) {
    accountId = conv.getString('account_id') || ''
  }

  let contact = null
  let isNewContact = false

  try {
    contact = $app.findFirstRecordByFilter(
      'crm_contacts',
      'instance_name = {:instance} && jid = {:jid}',
      { instance: instanceName, jid: remoteJid },
    )
  } catch (_) {
    try {
      const contactCol = $app.findCollectionByNameOrId('crm_contacts')
      contact = new Record(contactCol)
      contact.set('user_id', userId)
      if (accountId) contact.set('account_id', accountId)
      contact.set('instance_name', instanceName)
      contact.set('jid', remoteJid)
      contact.set('phone', remoteJid.split('@')[0])
      const pushName =
        msg.getString('push_name') || (conv ? conv.getString('contact_name') : '') || ''
      contact.set('push_name', pushName)
      contact.set('contact_name', (conv ? conv.getString('contact_name') : '') || pushName || '')
      contact.set('avatar_url', (conv ? conv.getString('avatar_url') : '') || '')
      contact.set('stage', 'lead')
      contact.set('role', '')
      $app.save(contact)
      isNewContact = true
    } catch (err) {
      $app.logger().error('crm_classify_create_error', 'error', String(err), 'jid', remoteJid)
      return e.next()
    }
  }

  if (!isText) return e.next()

  const openaiKey = $secrets.get('OPENAI_API_KEY')
  if (!openaiKey) return e.next()

  const CLASSIFY_EVERY_N = 5

  let messageCount = 0
  try {
    const row = $app
      .db()
      .newQuery(
        'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE remote_jid = {:jid} AND instance_name = {:instance} AND from_me = 0',
      )
      .bind({ jid: remoteJid, instance: instanceName })
      .one()
    if (row && row.cnt) messageCount = parseInt(row.cnt, 10) || 0
  } catch (_) {
    messageCount = 1
  }

  if (!isNewContact && messageCount > 1 && messageCount % CLASSIFY_EVERY_N !== 0) {
    return e.next()
  }

  let recentMessages = []
  try {
    recentMessages = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:instance}',
      '-timestamp',
      10,
      0,
      { jid: remoteJid, instance: instanceName },
    )
  } catch (_) {
    return e.next()
  }

  if (recentMessages.length === 0) return e.next()

  const sorted = recentMessages.slice().reverse()
  let transcript = ''
  for (const m of sorted) {
    const fromMe = m.getBool('from_me')
    const content = m.getString('content') || '[midia]'
    const sender = fromMe ? 'Atendente' : m.getString('push_name') || 'Contato'
    transcript += sender + ': ' + content + '\n'
  }

  const systemPrompt =
    'Voce e um classificador de CRM para conversas de WhatsApp. Analise a conversa abaixo e classifique o contato.\n\n' +
    'Retorne APENAS um objeto JSON valido (sem texto adicional) com:\n' +
    '- "stage": uma de "lead", "em_atendimento", "cliente", "nao_respondido"\n' +
    '  - "lead": contato inicial, sem conversa significativa ainda\n' +
    '  - "em_atendimento": conversa ativa, sendo atendido\n' +
    '  - "cliente": consulta confirmada ou servico contratado\n' +
    '  - "nao_respondido": contato parou de responder\n' +
    '- "role": "paciente" ou "nao_paciente"\n\n' +
    'Exemplo: {"stage":"em_atendimento","role":"paciente"}'

  let openaiRes
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
    $app.logger().error('crm_classify_openai_error', 'error', String(err), 'jid', remoteJid)
    return e.next()
  }

  if (openaiRes.statusCode !== 200) {
    $app
      .logger()
      .warn('crm_classify_openai_status', 'status', openaiRes.statusCode, 'jid', remoteJid)
    return e.next()
  }

  let contentText = ''
  try {
    contentText = openaiRes.json.choices[0].message.content
  } catch (_) {
    return e.next()
  }

  let classification = null
  try {
    classification = JSON.parse(contentText)
  } catch (_) {
    const match = contentText.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        classification = JSON.parse(match[0])
      } catch (_) {}
    }
  }

  if (!classification) return e.next()

  const validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
  const newStage = validStages.indexOf(classification.stage) >= 0 ? classification.stage : null
  if (!newStage) return e.next()

  const newRole =
    classification.role === 'paciente' || classification.role === 'nao_paciente'
      ? classification.role
      : null

  try {
    const contactRecord = $app.findRecordById('crm_contacts', contact.id)
    contactRecord.set('stage', newStage)
    if (newRole) contactRecord.set('role', newRole)
    $app.save(contactRecord)
  } catch (err) {
    $app.logger().error('crm_classify_update_error', 'error', String(err), 'jid', remoteJid)
  }

  return e.next()
}, 'whatsapp_messages')
