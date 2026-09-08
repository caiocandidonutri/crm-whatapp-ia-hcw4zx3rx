routerAdd(
  'POST',
  '/backend/v1/whatsapp/forward-message',
  (e) => {
    const body = e.requestInfo().body || {}
    const { instanceName, targetRemoteJid, messageId } = body

    if (!instanceName || !targetRemoteJid || !messageId) {
      throw new BadRequestError('Parâmetros ausentes: instanceName, targetRemoteJid, messageId')
    }

    const userId = e.auth?.id
    if (!userId) {
      throw new UnauthorizedError('Não autorizado')
    }

    try {
      $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'instance_name = {:instanceName} && user_id = {:userId}',
        { instanceName, userId },
      )
    } catch (_) {
      throw new ForbiddenError('Instância não encontrada ou não pertence ao usuário')
    }

    const originalMsg = $app.findRecordById('whatsapp_messages', messageId)
    if (!originalMsg) {
      throw new NotFoundError('Mensagem original não encontrada')
    }

    const apiUrl = $secrets.get('EVOLUTION_API_URL')
    const apiKey = $secrets.get('EVOLUTION_API_KEY')
    if (!apiUrl || !apiKey) {
      throw new InternalServerError('Configurações da Evolution API não encontradas')
    }

    let url = apiUrl
    if (url.endsWith('/')) url = url.slice(0, -1)

    const isGroup = targetRemoteJid.endsWith('@g.us')
    const evolutionNumber = isGroup ? targetRemoteJid : targetRemoteJid.split('@')[0]
    const content = originalMsg.getString('content')
    const msgType = originalMsg.getString('message_type')
    const mediaFile = originalMsg.getString('media_file')
    const mediaUrl = originalMsg.getString('media_url')

    let forwardSuccess = false
    let newMsgId = ''
    let sentContent = content

    // Tentativa 1: Endpoint oficial de forwardMessage da Evolution API se a mensagem original tiver message_id do WhatsApp
    const origWaId = originalMsg.getString('message_id')
    if (origWaId) {
      try {
        const fwdPayload = {
          number: evolutionNumber,
          messageId: origWaId,
        }
        const fwdRes = $http.send({
          url: `${url}/message/forwardMessage/${instanceName}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify(fwdPayload),
          timeout: 15,
        })
        if (fwdRes.statusCode === 200 || fwdRes.statusCode === 201) {
          forwardSuccess = true
          if (fwdRes.json?.key?.id) {
            newMsgId = fwdRes.json.key.id
          }
        }
      } catch (err) {
        $app.logger().warn('forwardMessage_endpoint_fail', 'error', String(err))
      }
    }

    // Tentativa 2: Fallback transparente enviando como novo envio (sendText ou sendMedia)
    if (!forwardSuccess) {
      if (mediaFile || mediaUrl) {
        // Envio de mídia
        let directUrl = mediaUrl
        if (!directUrl && mediaFile) {
          directUrl = `${$app.baseUrl()}/api/files/whatsapp_messages/${originalMsg.id}/${mediaFile}`
        }

        let medType = 'image'
        if (msgType.includes('audio') || msgType.includes('ptt')) medType = 'audio'
        else if (msgType.includes('video')) medType = 'video'
        else if (msgType.includes('document')) medType = 'document'

        const medPayload = {
          number: evolutionNumber,
          mediatype: medType,
          media: directUrl,
          caption: content || '',
          fileName: originalMsg.getString('media_filename') || 'arquivo',
        }

        const medRes = $http.send({
          url: `${url}/message/sendMedia/${instanceName}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify(medPayload),
          timeout: 20,
        })

        if (medRes.statusCode === 200 || medRes.statusCode === 201) {
          forwardSuccess = true
          if (medRes.json?.key?.id) newMsgId = medRes.json.key.id
        } else {
          throw new BadRequestError('Falha ao encaminhar mídia pela Evolution API')
        }
      } else if (content) {
        // Envio de texto
        const txtRes = $http.send({
          url: `${url}/message/sendText/${instanceName}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({ number: evolutionNumber, text: content }),
          timeout: 15,
        })
        if (txtRes.statusCode === 200 || txtRes.statusCode === 201) {
          forwardSuccess = true
          if (txtRes.json?.key?.id) newMsgId = txtRes.json.key.id
        } else {
          throw new BadRequestError('Falha ao encaminhar texto pela Evolution API')
        }
      }
    }

    // Gravar a mensagem encaminhada na conversa de destino
    let accountId = ''
    try {
      const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
        userId,
      })
      accountId = member.getString('account_id')
    } catch (_) {}

    const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
    const newMsgRecord = new Record(msgCol)
    newMsgRecord.set('user_id', userId)
    if (accountId) newMsgRecord.set('account_id', accountId)
    newMsgRecord.set('instance_name', instanceName)
    newMsgRecord.set('remote_jid', targetRemoteJid)
    newMsgRecord.set('from_me', true)
    newMsgRecord.set('content', content)
    newMsgRecord.set('message_type', msgType || 'conversation')
    newMsgRecord.set('is_forwarded', true)
    newMsgRecord.set('status', 'pending')
    newMsgRecord.set('timestamp', Math.floor(Date.now() / 1000))
    if (newMsgId) newMsgRecord.set('message_id', newMsgId)
    if (mediaFile) newMsgRecord.set('media_file', mediaFile)
    if (mediaUrl) newMsgRecord.set('media_url', mediaUrl)

    $app.save(newMsgRecord)

    // Atualizar last_message da conversa de destino
    const nowTs = Math.floor(Date.now() / 1000)
    try {
      const conv = $app.findFirstRecordByFilter(
        'conversations',
        'instance_name = {:instanceName} && remote_jid = {:remoteJid}',
        { instanceName, remoteJid: targetRemoteJid },
      )
      conv.set('last_message', content || '[Mídia encaminhada]')
      conv.set('last_message_timestamp', nowTs)
      conv.set('unread_count', 0)
      $app.save(conv)
    } catch (_) {}

    return e.json(200, { success: true, message: newMsgRecord })
  },
  $apis.requireAuth(),
)
