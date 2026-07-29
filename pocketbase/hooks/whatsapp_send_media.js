routerAdd(
  'POST',
  '/backend/v1/whatsapp/send-media',
  (e) => {
    const body = e.requestInfo().body || {}
    const instanceName = body.instanceName
    const number = body.number
    const mediatype = body.mediatype
    const caption = body.caption || ''
    const mimetype = body.mimetype || ''
    const fileName = body.fileName || 'file'
    const base64 = body.base64

    if (!instanceName || !number || !base64 || !mediatype) {
      throw new BadRequestError('Parâmetros ausentes: instanceName, number, base64, mediatype')
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

    // Mesma normalização de JID do whatsapp_send_message.js: preserva o JID
    // original quando vem com domínio (@g.us / @s.whatsapp.net) e gera um
    // formato canônico pra Evolution API. Fix do bug em que mandar mídia
    // pra grupo criava uma "conversa nova" individual sem nome.
    const incoming = String(number)
    const isGroup = incoming.endsWith('@g.us')
    const hasDomain = incoming.indexOf('@') !== -1
    const remoteJid = hasDomain ? incoming : incoming + '@s.whatsapp.net'
    const evolutionNumber = isGroup ? incoming : incoming.split('@')[0]

    let endpoint = ''
    let payload = {}

    if (mediatype === 'audio') {
      endpoint = `${url}/message/sendWhatsAppAudio/${instanceName}`
      payload = {
        number: evolutionNumber,
        audio: base64,
      }
    } else {
      endpoint = `${url}/message/sendMedia/${instanceName}`
      payload = {
        number: evolutionNumber,
        mediatype,
        mimetype,
        caption: caption,
        media: base64,
        fileName: fileName,
      }
    }

    const res = $http.send({
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(payload),
      timeout: 30,
    })

    if (res.statusCode !== 200 && res.statusCode !== 201) {
      let errBody = ''
      try {
        errBody = res.body ? new TextDecoder().decode(res.body) : ''
      } catch (err) {}
      $app.logger().error('Erro Evolution API sendMedia', 'status', res.statusCode, 'body', errBody)
      throw new BadRequestError('Erro ao enviar mídia pela Evolution API')
    }

    function decodeBase64(b64Str) {
      const b64 = b64Str.replace(/[^A-Za-z0-9+/=]/g, '')
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const lookup = new Uint8Array(256)
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i
      }
      let bufferLength = b64.length * 0.75,
        len = b64.length,
        i,
        p = 0,
        encoded1,
        encoded2,
        encoded3,
        encoded4

      if (b64[len - 1] === '=') bufferLength--
      if (b64[len - 2] === '=') bufferLength--

      const bytes = new Uint8Array(bufferLength)

      for (i = 0; i < len; i += 4) {
        encoded1 = lookup[b64.charCodeAt(i)]
        encoded2 = lookup[b64.charCodeAt(i + 1)]
        encoded3 = lookup[b64.charCodeAt(i + 2)]
        encoded4 = lookup[b64.charCodeAt(i + 3)]

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4)
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2)
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63)
      }

      return bytes
    }

    const bytes = decodeBase64(base64)

    let safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    if (safeName.length > 200) {
      const extIndex = safeName.lastIndexOf('.')
      if (extIndex > -1) {
        const ext = safeName.substring(extIndex)
        safeName = safeName.substring(0, 200 - ext.length) + ext
      } else {
        safeName = safeName.substring(0, 200)
      }
    }

    const fileObj = $filesystem.fileFromBytes(bytes, safeName)

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
    msgRecord.set('message_type', mediatype)
    msgRecord.set('status', 'pending')
    msgRecord.set('timestamp', Math.floor(Date.now() / 1000))
    msgRecord.set('content', caption || '')
    msgRecord.set('media_mimetype', mimetype)
    msgRecord.set('media_filename', safeName)

    const parsedRes = res.json || {}
    if (parsedRes.key?.id) {
      msgRecord.set('message_id', parsedRes.key.id)
    }

    msgRecord.set('media_file', fileObj)

    $app.save(msgRecord)

    let pbUrl = $secrets.get('PB_INSTANCE_URL')
    if (!pbUrl) {
      pbUrl = ''
    } else if (pbUrl.endsWith('/')) {
      pbUrl = pbUrl.slice(0, -1)
    }

    const savedFileName = msgRecord.getString('media_file')
    if (savedFileName) {
      if (pbUrl) {
        msgRecord.set(
          'media_url',
          `${pbUrl}/api/files/whatsapp_messages/${msgRecord.id}/${savedFileName}`,
        )
      } else {
        msgRecord.set('media_url', `/api/files/whatsapp_messages/${msgRecord.id}/${savedFileName}`)
      }
      $app.save(msgRecord)
    }

    let lastMsgText = ''
    if (mediatype === 'image') lastMsgText = caption ? `[Imagem] ${caption}` : '[Imagem]'
    else if (mediatype === 'video') lastMsgText = caption ? `[Vídeo] ${caption}` : '[Vídeo]'
    else if (mediatype === 'audio') lastMsgText = '[Áudio]'
    else if (mediatype === 'document') lastMsgText = `[Documento] ${fileName}`
    else lastMsgText = `[Mídia]`

    const nowTs = Math.floor(Date.now() / 1000)
    try {
      const conv = $app.findFirstRecordByFilter(
        'conversations',
        'instance_name = {:instanceName} && remote_jid = {:remoteJid}',
        { instanceName, remoteJid },
      )
      conv.set('last_message', lastMsgText)
      conv.set('last_message_timestamp', nowTs)
      conv.set('unread_count', 0)

      if (conv.getBool('ai_enabled')) {
        conv.set('ai_enabled', false)
        $app
          .logger()
          .info(
            'AI disabled due to manual media send',
            'tag',
            'ai_auto_disabled',
            'conv_id',
            conv.id,
            'reason',
            'manual_media_send',
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
      newConv.set('last_message', lastMsgText)
      newConv.set('last_message_timestamp', nowTs)
      newConv.set('unread_count', 0)
      $app.save(newConv)
    }

    return e.json(200, { success: true, message: msgRecord })
  },
  $apis.requireAuth(),
)
