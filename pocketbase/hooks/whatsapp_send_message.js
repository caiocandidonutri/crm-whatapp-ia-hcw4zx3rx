routerAdd(
  'POST',
  '/backend/v1/whatsapp/send-message',
  (e) => {
    const body = e.requestInfo().body || {}
    const { instanceName, number, text } = body

    if (!instanceName || !number || !text) {
      throw new BadRequestError('Parâmetros ausentes: instanceName, number, text')
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

    const apiUrl = $secrets.get('EVOLUTION_API_URL')
    const apiKey = $secrets.get('EVOLUTION_API_KEY')

    if (!apiUrl || !apiKey) {
      throw new InternalServerError('Configurações da Evolution API não encontradas')
    }

    let url = apiUrl
    if (url.endsWith('/')) url = url.slice(0, -1)

    // O front envia activeConversation.remote_jid no campo `number`. Pode vir como:
    //   - "12345@g.us"           (grupo)
    //   - "12345@s.whatsapp.net" (individual, com domínio)
    //   - "12345"                (número solto)
    // Antes: split('@')[0] + '@s.whatsapp.net' quebrava o JID de grupo em
    // pseudo-JID individual, criando uma "conversa nova" sem nome toda vez
    // que o user mandava msg para grupo. Agora preservamos o JID original
    // pro storage e mandamos pra Evolution o formato canônico de cada tipo.
    const incoming = String(number)
    const isGroup = incoming.endsWith('@g.us')
    const hasDomain = incoming.indexOf('@') !== -1
    const remoteJid = hasDomain ? incoming : incoming + '@s.whatsapp.net'
    const evolutionNumber = isGroup ? incoming : incoming.split('@')[0]

    const res = $http.send({
      url: `${url}/message/sendText/${instanceName}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ number: evolutionNumber, text }),
      timeout: 15,
    })

    if (res.statusCode !== 200 && res.statusCode !== 201) {
      let errBody = ''
      try {
        errBody = res.body ? new TextDecoder().decode(res.body) : ''
      } catch (err) {}
      $app.logger().error('Erro Evolution API sendText', 'status', res.statusCode, 'body', errBody)
      throw new BadRequestError('Erro ao enviar mensagem pela Evolution API')
    }

    let accountId = ''
    try {
      const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
        userId,
      })
      accountId = member.getString('account_id')
    } catch (_) {}

    const msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
    const msgRecord = new Record(msgCol)
    msgRecord.set('user_id', userId)
    if (accountId) msgRecord.set('account_id', accountId)
    msgRecord.set('instance_name', instanceName)
    msgRecord.set('remote_jid', remoteJid)
    msgRecord.set('from_me', true)
    msgRecord.set('content', text)
    msgRecord.set('message_type', 'conversation')
    msgRecord.set('status', 'pending')
    msgRecord.set('timestamp', Math.floor(Date.now() / 1000))

    const parsedRes = res.json || {}
    if (parsedRes.key?.id) {
      msgRecord.set('message_id', parsedRes.key.id)
    }
    $app.save(msgRecord)

    const nowTs = Math.floor(Date.now() / 1000)
    try {
      const conv = $app.findFirstRecordByFilter(
        'conversations',
        'instance_name = {:instanceName} && remote_jid = {:remoteJid}',
        { instanceName, remoteJid },
      )
      conv.set('last_message', text)
      conv.set('last_message_timestamp', nowTs)
      conv.set('unread_count', 0)

      if (conv.getBool('ai_enabled')) {
        conv.set('ai_enabled', false)
        $app
          .logger()
          .info(
            'AI disabled due to manual text send',
            'tag',
            'ai_auto_disabled',
            'conv_id',
            conv.id,
            'reason',
            'manual_text_send',
          )
      }

      $app.save(conv)
    } catch (_) {
      const convCol = $app.findCollectionByNameOrId('conversations')
      const newConv = new Record(convCol)
      newConv.set('user_id', userId)
      if (accountId) newConv.set('account_id', accountId)
      newConv.set('instance_name', instanceName)
      newConv.set('remote_jid', remoteJid)
      newConv.set('is_group', isGroup)
      newConv.set('type', isGroup ? 'group' : 'individual')
      newConv.set('last_message', text)
      newConv.set('last_message_timestamp', nowTs)
      newConv.set('unread_count', 0)
      $app.save(newConv)
    }

    return e.json(200, { success: true, message: msgRecord })
  },
  $apis.requireAuth(),
)
