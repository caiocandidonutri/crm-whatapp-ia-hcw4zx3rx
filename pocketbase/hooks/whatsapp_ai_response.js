onRecordAfterCreateSuccess((e) => {
  const msg = e.record
  if (msg.getBool('from_me')) return e.next()

  const remoteJid = msg.getString('remote_jid')
  if (remoteJid.endsWith('@g.us')) return e.next()

  let conv
  try {
    conv = $app.findFirstRecordByFilter(
      'conversations',
      'remote_jid = {:jid} && instance_name = {:instance}',
      { jid: remoteJid, instance: msg.getString('instance_name') },
    )
  } catch (_) {
    return e.next()
  }

  if (!conv.getBool('ai_enabled')) return e.next()

  const agentId = conv.getString('ai_agent_id')
  if (!agentId) return e.next()

  let userAgentPrompt = ''
  try {
    const agent = $app.findRecordById('ai_agents', agentId)
    userAgentPrompt = agent.getString('system_prompt')
  } catch (_) {
    return e.next()
  }

  const userId = msg.getString('user_id')

  let latestMsg
  try {
    latestMsg = $app.findRecordById('whatsapp_messages', msg.id)
  } catch (_) {
    return e.next()
  }

  try {
    const textContent = msg.getString('content') || 'Mensagem em formato de mídia.'
    const finalMessage = `<system_instruction>
Siga estritamente esta Persona/Instrução do usuário para moldar sua resposta e comportamento:
${userAgentPrompt}
</system_instruction>

${textContent}`

    let aiConvId = conv.getString('ai_conversation_id') || null

    const result = $ai.agent('whatsapp-manager').chat({
      user_id: userId,
      conversation_id: aiConvId,
      message: finalMessage,
    })

    if (!aiConvId && result.conversation_id) {
      conv.set('ai_conversation_id', result.conversation_id)
      $app.save(conv)
    }

    const replyText = result.content

    if (replyText) {
      const apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
      const apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
      const evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''

      if (apiUrl && evApiKey) {
        const evolutionNumber = remoteJid.split('@')[0]

        const sendRes = $http.send({
          url: `${apiUrl}/message/sendText/${msg.getString('instance_name')}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: evApiKey },
          body: JSON.stringify({
            number: evolutionNumber,
            text: replyText,
          }),
          timeout: 30,
        })

        if (sendRes.statusCode >= 200 && sendRes.statusCode < 300) {
          let sentMsgId = ''
          try {
            sentMsgId = sendRes.json?.key?.id
          } catch (_) {}
          if (!sentMsgId) sentMsgId = `ai_${$security.randomString(16)}`

          let accountId = msg.getString('account_id')

          const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
          const newMsg = new Record(msgCol)
          newMsg.set('user_id', userId)
          if (accountId) newMsg.set('account_id', accountId)
          newMsg.set('instance_name', msg.getString('instance_name'))
          newMsg.set('remote_jid', remoteJid)
          newMsg.set('from_me', true)
          newMsg.set('message_id', sentMsgId)
          newMsg.set('push_name', 'Assistente')
          newMsg.set('content', replyText)
          newMsg.set('message_type', 'conversation')
          newMsg.set('status', 'pending')
          const nowTs = Math.floor(Date.now() / 1000)
          newMsg.set('timestamp', nowTs)
          $app.save(newMsg)

          conv.set('last_message', replyText)
          conv.set('last_message_timestamp', nowTs)
          conv.set('unread_count', 0)
          $app.save(conv)
        } else {
          latestMsg.set('ai_response_error', `Evolution API Error: ${sendRes.statusCode}`)
        }
      } else {
        latestMsg.set('ai_response_error', 'Evolution API credentials missing')
      }
    }
  } catch (err) {
    console.error('AI Agent Error:', err)
    latestMsg.set('ai_response_error', String(err.message).substring(0, 1000))
  } finally {
    latestMsg.set('pending_ai_response', false)
    $app.saveNoValidate(latestMsg)
  }

  return e.next()
}, 'whatsapp_messages')
