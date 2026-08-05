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
  let agentRecord = null
  try {
    agentRecord = $app.findRecordById('ai_agents', agentId)
    userAgentPrompt = agentRecord.getString('system_prompt')
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

  var now = new Date()
  var brazilMs = now.getTime() - 3 * 60 * 60 * 1000
  var brazilTime = new Date(brazilMs)
  var dayOfWeek = brazilTime.getUTCDay()
  var hour = brazilTime.getUTCHours()
  var isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  var isAfter19 = hour >= 19

  if (!isWeekend && !isAfter19) {
    latestMsg.set('pending_ai_response', false)
    $app.saveNoValidate(latestMsg)
    return e.next()
  }

  var incomingCount = 0
  try {
    var prevMsgs = $app.findRecordsByFilter(
      'whatsapp_messages',
      'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
      '-timestamp',
      5,
      0,
      { jid: remoteJid, inst: msg.getString('instance_name') },
    )
    incomingCount = prevMsgs.length
  } catch (_) {}

  var isNewLead = incomingCount <= 2

  var documentContext = ''
  var availableDocs = []
  if (agentRecord) {
    var docsStr = agentRecord.getString('documents')
    if (docsStr) {
      availableDocs = docsStr
        .split(',')
        .map(function (d) {
          return d.trim()
        })
        .filter(function (d) {
          return d.length > 0
        })
      if (availableDocs.length > 0) {
        documentContext = '\n\nDocumentos disponiveis para envio ao paciente:\n'
        for (var i = 0; i < availableDocs.length; i++) {
          documentContext += i + 1 + '. ' + availableDocs[i] + '\n'
        }
        documentContext +=
          'Se precisar enviar um documento, inclua exatamente [ENVIAR_DOCUMENTO:nome_do_arquivo] em sua resposta.'
      }
    }
  }

  try {
    var textContent = msg.getString('content') || 'Mensagem em formato de midia.'

    var leadContext = isNewLead
      ? '\n\n[CONTEXTO: Este e um LEAD NOVO. Aja como agente closer: apresente-se, explique sobre o profissional, servicos e valores, conduza ao agendamento.]'
      : '\n\n[CONTEXTO: Contato antigo/paciente. Use o contexto da conversa para atendimento personalizado.]'

    var finalMessage =
      '<system_instruction>\nSiga estritamente esta Persona/Instrucao:\n' +
      userAgentPrompt +
      '\n</system_instruction>' +
      leadContext +
      documentContext +
      '\n\nMensagem: ' +
      textContent

    var aiConvId = conv.getString('ai_conversation_id') || null

    var result = $ai.agent('whatsapp-manager').chat({
      user_id: userId,
      conversation_id: aiConvId,
      message: finalMessage,
    })

    if (!aiConvId && result.conversation_id) {
      conv.set('ai_conversation_id', result.conversation_id)
      $app.save(conv)
    }

    var replyText = result.content || ''

    var docToSend = null
    if (replyText && availableDocs.length > 0) {
      var docMatch = replyText.match(/\[ENVIAR_DOCUMENTO:([^\]]+)\]/)
      if (docMatch) {
        var requestedDoc = docMatch[1].trim()
        replyText = replyText.replace(/\[ENVIAR_DOCUMENTO:[^\]]+\]/g, '').trim()
        for (var j = 0; j < availableDocs.length; j++) {
          if (availableDocs[j] === requestedDoc) {
            docToSend = requestedDoc
            break
          }
        }
      }
    }

    if (replyText) {
      var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
      var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
      var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''

      if (apiUrl && evApiKey) {
        var evolutionNumber = remoteJid.split('@')[0]
        var instanceName = msg.getString('instance_name')
        var accountId = msg.getString('account_id')
        var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')

        var sendRes = $http.send({
          url: apiUrl + '/message/sendText/' + instanceName,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: evApiKey },
          body: JSON.stringify({ number: evolutionNumber, text: replyText }),
          timeout: 30,
        })

        if (sendRes.statusCode >= 200 && sendRes.statusCode < 300) {
          var sentMsgId = ''
          try {
            sentMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
          } catch (_) {}
          if (!sentMsgId) sentMsgId = 'ai_' + $security.randomString(16)

          var newMsg = new Record(msgCol)
          newMsg.set('user_id', userId)
          if (accountId) newMsg.set('account_id', accountId)
          newMsg.set('instance_name', instanceName)
          newMsg.set('remote_jid', remoteJid)
          newMsg.set('from_me', true)
          newMsg.set('message_id', sentMsgId)
          newMsg.set('push_name', 'Assistente')
          newMsg.set('content', replyText)
          newMsg.set('message_type', 'conversation')
          newMsg.set('status', 'pending')
          var nowTs = Math.floor(Date.now() / 1000)
          newMsg.set('timestamp', nowTs)
          $app.save(newMsg)

          conv.set('last_message', replyText)
          conv.set('last_message_timestamp', nowTs)
          conv.set('unread_count', 0)
          $app.save(conv)
        } else {
          latestMsg.set('ai_response_error', 'Evolution API Error: ' + sendRes.statusCode)
        }

        if (docToSend) {
          try {
            var pbUrl = $secrets.get('PB_INSTANCE_URL') || ''
            var pbBase = pbUrl.endsWith('/') ? pbUrl.slice(0, -1) : pbUrl
            var superToken = $secrets.get('PB_SUPERUSER_TOKEN') || ''
            var docUrl = pbBase + '/api/files/ai_agents/' + agentRecord.id + '/' + docToSend

            var docRes = $http.send({
              url: docUrl,
              method: 'GET',
              headers: { Authorization: superToken },
              timeout: 30,
            })

            if (docRes.statusCode === 200 && docRes.body) {
              var bytes = docRes.body
              var b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
              var base64 = ''
              var blen = bytes.length
              for (var k = 0; k < blen; k += 3) {
                var c1 = bytes[k] & 0xff
                var c2 = k + 1 < blen ? bytes[k + 1] & 0xff : 0
                var c3 = k + 2 < blen ? bytes[k + 2] & 0xff : 0
                base64 += b64chars.charAt(c1 >> 2)
                base64 += b64chars.charAt(((c1 & 3) << 4) | (c2 >> 4))
                base64 += k + 1 < blen ? b64chars.charAt(((c2 & 15) << 2) | (c3 >> 6)) : '='
                base64 += k + 2 < blen ? b64chars.charAt(c3 & 63) : '='
              }

              var ext = docToSend.split('.').pop().toLowerCase()
              var mediatype = 'document'
              var mimetype = 'application/octet-stream'
              if (ext === 'pdf') {
                mimetype = 'application/pdf'
              } else if (ext === 'jpg' || ext === 'jpeg') {
                mimetype = 'image/jpeg'
                mediatype = 'image'
              } else if (ext === 'png') {
                mimetype = 'image/png'
                mediatype = 'image'
              } else if (ext === 'webp') {
                mimetype = 'image/webp'
                mediatype = 'image'
              }

              var mediaRes = $http.send({
                url: apiUrl + '/message/sendMedia/' + instanceName,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: evApiKey },
                body: JSON.stringify({
                  number: evolutionNumber,
                  mediatype: mediatype,
                  mimetype: mimetype,
                  caption: '',
                  media: base64,
                  fileName: docToSend,
                }),
                timeout: 30,
              })

              if (mediaRes.statusCode >= 200 && mediaRes.statusCode < 300) {
                var mediaMsgId = ''
                try {
                  mediaMsgId = mediaRes.json && mediaRes.json.key && mediaRes.json.key.id
                } catch (_) {}
                if (!mediaMsgId) mediaMsgId = 'ai_doc_' + $security.randomString(16)

                var mediaMsg = new Record(msgCol)
                mediaMsg.set('user_id', userId)
                if (accountId) mediaMsg.set('account_id', accountId)
                mediaMsg.set('instance_name', instanceName)
                mediaMsg.set('remote_jid', remoteJid)
                mediaMsg.set('from_me', true)
                mediaMsg.set('message_id', mediaMsgId)
                mediaMsg.set('push_name', 'Assistente')
                mediaMsg.set('content', '[Documento] ' + docToSend)
                mediaMsg.set('message_type', mediatype)
                mediaMsg.set('status', 'pending')
                mediaMsg.set('timestamp', Math.floor(Date.now() / 1000))
                $app.save(mediaMsg)
              }
            }
          } catch (docErr) {
            $app.logger().error('ai_response: document send failed', 'error', String(docErr))
          }
        }
      } else {
        latestMsg.set('ai_response_error', 'Evolution API credentials missing')
      }
    }
  } catch (err) {
    $app.logger().error('AI Agent Error', 'error', String(err))
    latestMsg.set('ai_response_error', String(err.message).substring(0, 1000))
  } finally {
    latestMsg.set('pending_ai_response', false)
    $app.saveNoValidate(latestMsg)
  }

  return e.next()
}, 'whatsapp_messages')
