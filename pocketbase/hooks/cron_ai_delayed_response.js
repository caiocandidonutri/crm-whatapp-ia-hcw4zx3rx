cronAdd('ai_delayed_response', '* * * * *', () => {
  var now = new Date()
  var brazilMs = now.getTime() - 3 * 60 * 60 * 1000
  var brazilTime = new Date(brazilMs)
  var dayOfWeek = brazilTime.getUTCDay()
  var hour = brazilTime.getUTCHours()
  var isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  var isBusinessHours = !isWeekend && ((hour >= 7 && hour < 11) || (hour >= 13 && hour < 19))
  var nowTs = Math.floor(Date.now() / 1000)

  var pendingMsgs = []
  try {
    pendingMsgs = $app.findRecordsByFilter(
      'whatsapp_messages',
      'pending_ai_response = true',
      'created',
      5,
      0,
    )
  } catch (_) {
    return
  }

  if (!pendingMsgs || pendingMsgs.length === 0) return

  var processAiResponse = function (msg) {
    var remoteJid = msg.getString('remote_jid')
    var instanceName = msg.getString('instance_name')
    var userId = msg.getString('user_id')

    var conv
    try {
      conv = $app.findFirstRecordByFilter(
        'conversations',
        'remote_jid = {:jid} && instance_name = {:instance}',
        { jid: remoteJid, instance: instanceName },
      )
    } catch (_) {
      return false
    }

    if (!conv.getBool('ai_enabled')) return false
    var agentId = conv.getString('ai_agent_id')
    if (!agentId) return false

    var userAgentPrompt = ''
    var agentRecord = null
    try {
      agentRecord = $app.findRecordById('ai_agents', agentId)
      userAgentPrompt = agentRecord.getString('system_prompt')
    } catch (_) {
      return false
    }

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

    var incomingCount = 0
    try {
      var prevMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
        '-timestamp',
        5,
        0,
        { jid: remoteJid, inst: instanceName },
      )
      incomingCount = prevMsgs.length
    } catch (_) {}
    var isNewLead = incomingCount <= 2

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

    var result
    try {
      result = $ai.agent('whatsapp-manager').chat({
        user_id: userId,
        conversation_id: aiConvId,
        message: finalMessage,
      })
    } catch (err) {
      $app.logger().error('cron_ai: agent chat failed', 'error', String(err))
      msg.set('ai_response_error', String(err.message || err).substring(0, 1000))
      return false
    }

    if (!aiConvId && result.conversation_id) {
      conv.set('ai_conversation_id', result.conversation_id)
      $app.save(conv)
    }

    var replyText = result.content || ''
    if (!replyText) return false

    var docToSend = null
    if (availableDocs.length > 0) {
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

    var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
    var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
    var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''

    if (!apiUrl || !evApiKey) {
      msg.set('ai_response_error', 'Evolution API credentials missing')
      return false
    }

    var evolutionNumber = remoteJid.split('@')[0]
    var accountId = msg.getString('account_id')
    var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')

    var sendRes = $http.send({
      url: apiUrl + '/message/sendText/' + instanceName,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evApiKey },
      body: JSON.stringify({ number: evolutionNumber, text: replyText }),
      timeout: 30,
    })

    if (sendRes.statusCode < 200 || sendRes.statusCode >= 300) {
      msg.set('ai_response_error', 'Evolution API Error: ' + sendRes.statusCode)
      return false
    }

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
    newMsg.set('timestamp', nowTs)
    $app.save(newMsg)

    conv.set('last_message', replyText)
    conv.set('last_message_timestamp', nowTs)
    conv.set('unread_count', 0)
    $app.save(conv)

    if (docToSend && agentRecord) {
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
        $app.logger().error('cron_ai: document send failed', 'error', String(docErr))
      }
    }

    return true
  }

  var sendOrientation = function (msg) {
    var remoteJid = msg.getString('remote_jid')
    var instanceName = msg.getString('instance_name')
    var userId = msg.getString('user_id')

    var recentAi = []
    try {
      recentAi = $app.findRecordsByFilter(
        'whatsapp_messages',
        'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && push_name = {:name}',
        '-timestamp',
        1,
        0,
        { jid: remoteJid, inst: instanceName, name: 'Assistente' },
      )
    } catch (_) {}

    if (recentAi.length > 0) {
      var lastAiTs = recentAi[0].getInt('timestamp') || 0
      if (nowTs - lastAiTs < 2 * 60 * 60) return true
    }

    var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
    var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
    var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
    if (!apiUrl || !evApiKey) return false

    var evolutionNumber = remoteJid.split('@')[0]
    var accountId = msg.getString('account_id')
    var orientationText =
      'Olá! Recebemos sua mensagem. Nosso atendimento humano está em pausa de almoço e retornará em breve. Obrigado pela paciência! 🙏'

    var sendRes = $http.send({
      url: apiUrl + '/message/sendText/' + instanceName,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evApiKey },
      body: JSON.stringify({ number: evolutionNumber, text: orientationText }),
      timeout: 30,
    })

    if (sendRes.statusCode < 200 || sendRes.statusCode >= 300) return false

    var sentMsgId = ''
    try {
      sentMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
    } catch (_) {}
    if (!sentMsgId) sentMsgId = 'ai_ori_' + $security.randomString(16)

    var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
    var newMsg = new Record(msgCol)
    newMsg.set('user_id', userId)
    if (accountId) newMsg.set('account_id', accountId)
    newMsg.set('instance_name', instanceName)
    newMsg.set('remote_jid', remoteJid)
    newMsg.set('from_me', true)
    newMsg.set('message_id', sentMsgId)
    newMsg.set('push_name', 'Assistente')
    newMsg.set('content', orientationText)
    newMsg.set('message_type', 'conversation')
    newMsg.set('status', 'pending')
    newMsg.set('timestamp', nowTs)
    $app.save(newMsg)

    try {
      var conv = $app.findFirstRecordByFilter(
        'conversations',
        'remote_jid = {:jid} && instance_name = {:instance}',
        { jid: remoteJid, instance: instanceName },
      )
      conv.set('last_message', orientationText)
      conv.set('last_message_timestamp', nowTs)
      conv.set('unread_count', 0)
      $app.save(conv)
    } catch (_) {}

    return true
  }

  for (var i = 0; i < pendingMsgs.length; i++) {
    var msg = pendingMsgs[i]
    var remoteJid = msg.getString('remote_jid')
    var instanceName = msg.getString('instance_name')
    var msgTs = msg.getInt('timestamp') || 0

    if (msg.getBool('from_me') || remoteJid.endsWith('@g.us')) {
      msg.set('pending_ai_response', false)
      $app.saveNoValidate(msg)
      continue
    }

    if (isBusinessHours) {
      msg.set('pending_ai_response', false)
      $app.saveNoValidate(msg)
      continue
    }

    var msgDate = new Date(msgTs * 1000)
    var msgBrazilMs = msgDate.getTime() - 3 * 60 * 60 * 1000
    var msgBrazilTime = new Date(msgBrazilMs)
    var msgDayOfWeek = msgBrazilTime.getUTCDay()
    var msgHour = msgBrazilTime.getUTCHours()
    var msgIsWeekend = msgDayOfWeek === 0 || msgDayOfWeek === 6
    var msgIsLunch = !msgIsWeekend && msgHour >= 11 && msgHour < 13
    var msgIsNightOrWeekend = msgIsWeekend || msgHour >= 19 || msgHour < 7

    if (msgIsLunch) {
      var outgoingMsgs = []
      try {
        outgoingMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:msgTs}',
          '-timestamp',
          5,
          0,
          { jid: remoteJid, inst: instanceName, msgTs: msgTs },
        )
      } catch (_) {}

      var humanReplied = false
      for (var j = 0; j < outgoingMsgs.length; j++) {
        if (outgoingMsgs[j].getString('push_name') !== 'Assistente') {
          humanReplied = true
          break
        }
      }

      if (humanReplied) {
        msg.set('pending_ai_response', false)
        $app.saveNoValidate(msg)
        continue
      }

      var elapsed = nowTs - msgTs
      if (elapsed >= 30 * 60) {
        var contact = null
        try {
          contact = $app.findFirstRecordByFilter(
            'crm_contacts',
            'instance_name = {:inst} && jid = {:jid}',
            { inst: instanceName, jid: remoteJid },
          )
        } catch (_) {}

        if (contact && contact.getString('stage') === 'nao_respondido') {
          try {
            processAiResponse(msg)
          } catch (err) {
            msg.set('ai_response_error', String(err.message || err).substring(0, 1000))
          }
        } else {
          try {
            sendOrientation(msg)
          } catch (err) {
            $app.logger().error('cron_ai: orientation failed', 'error', String(err))
          }
        }
        msg.set('pending_ai_response', false)
        $app.saveNoValidate(msg)
      }
      continue
    }

    if (msgIsNightOrWeekend) {
      var attemptedAt = msg.getString('ai_response_attempted_at')
      var attemptedTs = 0
      if (attemptedAt) {
        try {
          attemptedTs = Math.floor(new Date(attemptedAt).getTime() / 1000)
        } catch (_) {}
      }
      if (attemptedTs === 0) attemptedTs = msgTs

      if (nowTs - attemptedTs >= 90) {
        try {
          processAiResponse(msg)
        } catch (err) {
          msg.set('ai_response_error', String(err.message || err).substring(0, 1000))
        }
        msg.set('pending_ai_response', false)
        $app.saveNoValidate(msg)
      }
      continue
    }

    msg.set('pending_ai_response', false)
    $app.saveNoValidate(msg)
  }
})
