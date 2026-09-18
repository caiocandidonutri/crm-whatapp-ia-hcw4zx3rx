cronAdd('ai_delayed_response', '*/10 * * * *', () => {
  try {
    // Kill switch global: aborto imediato na PRIMEIRA linha
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        return
      }
    } catch (_) {}

    function isNightShieldActive() {
      var nMs = Date.now()
      var spD = new Date(nMs - 3 * 3600 * 1000)
      var hSp = spD.getUTCHours()
      return hSp >= 21 || hSp < 7
    }

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

    var isGlobalAutomationsPaused = function (accountId) {
      try {
        var filter = 'global_automations_paused = true'
        if (accountId) {
          filter = 'account_id = "' + accountId + '" && global_automations_paused = true'
        }
        var pausedRec = $app.findFirstRecordByFilter('care_alert_settings', filter)
        if (pausedRec) return true
      } catch (_) {}
      // Se não encontrou específico, verifica se há qualquer conta pausada
      try {
        var anyPaused = $app.findFirstRecordByFilter(
          'care_alert_settings',
          'global_automations_paused = true',
        )
        if (anyPaused) return true
      } catch (_) {}
      return false
    }

    // Verifica se o horário atual está dentro de um período de silêncio
    // configurado para a conta. Se sim, NÃO dispara mensagens automáticas
    // da IA — o paciente continuará pendente e será reavaliado no próximo
    // minuto quando o silêncio terminar.
    var isAccountSilenced = function (accountId) {
      if (!accountId) return false
      var periods = []
      try {
        periods = $app.findRecordsByFilter(
          'care_silence_periods',
          'account_id = {:aid} && enabled = true',
          '-created',
          50,
          0,
          { aid: accountId },
        )
      } catch (_) {
        return false
      }
      if (!periods || periods.length === 0) return false
      var silNow = new Date()
      var silHHMM =
        ('0' + silNow.getHours()).slice(-2) + ':' + ('0' + silNow.getMinutes()).slice(-2)
      var silDay = silNow.getDay()
      for (var sp = 0; sp < periods.length; sp++) {
        var spStart = periods[sp].getString('start_time')
        var spEnd = periods[sp].getString('end_time')
        if (!spStart || !spEnd) continue
        var spWdRaw = periods[sp].get('weekdays')
        var spWd = []
        if (spWdRaw) {
          try {
            var spParsed = typeof spWdRaw === 'string' ? JSON.parse(spWdRaw) : spWdRaw
            if (Array.isArray(spParsed)) spWd = spParsed
          } catch (_) {}
        }
        if (spWd.length > 0 && spWd.indexOf(silDay) === -1) continue
        if (spStart <= spEnd) {
          if (silHHMM >= spStart && silHHMM < spEnd) return true
        } else {
          if (silHHMM >= spStart || silHHMM < spEnd) return true
        }
      }
      return false
    }

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

      // ---- Contexto do CRM do contato ----
      // Buscamos o registro em crm_contacts pelo (instance_name, jid) para
      // enriquecer o prompt com a identificação exata do paciente (nome completo,
      // telefone sem @s.whatsapp.net), fase no pipeline, status de cuidado,
      // data da última consulta e ação sugerida.
      var crmContact = null
      try {
        crmContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: instanceName, jid: remoteJid },
        )
      } catch (_) {}

      // Resolução robusta do nome do contato
      var rawContactName = ''
      if (crmContact) {
        rawContactName =
          crmContact.getString('contact_name') || crmContact.getString('push_name') || ''
      }
      if (!rawContactName && conv) {
        rawContactName = conv.getString('contact_name') || conv.getString('push_name') || ''
      }
      if (!rawContactName && msg) {
        rawContactName = msg.getString('push_name') || ''
      }

      // Filtra nomes inválidos / que pertençam à equipe da clínica
      var lowerRaw = rawContactName.toLowerCase().trim()
      var isSelfName =
        lowerRaw === 'você' ||
        lowerRaw === 'voce' ||
        lowerRaw === 'assistente' ||
        lowerRaw === 'dr. caio' ||
        lowerRaw === 'dr caio' ||
        lowerRaw === 'dr. caio cândido nutri' ||
        lowerRaw === 'dr caio candido nutri' ||
        lowerRaw === 'dr. caio nutricionista' ||
        lowerRaw === 'dr caio nutricionista' ||
        (lowerRaw.indexOf('fabiana') !== -1 && lowerRaw.indexOf('assistente') !== -1) ||
        lowerRaw === 'fabiana assistente dr. caio nutricionista' ||
        lowerRaw === 'fabiana assistente dr. caio cândido nutri' ||
        lowerRaw === 'fabiana assistente dr. caio candido nutri'

      var contactName = !isSelfName && rawContactName.trim() ? rawContactName.trim() : 'Paciente'
      var contactPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '')

      var crmStage = crmContact ? crmContact.getString('stage') || '' : ''
      var crmCareStatus = crmContact ? crmContact.getString('care_status') || '' : ''
      var crmConvertedAt = crmContact ? crmContact.getString('converted_at') || '' : ''
      var crmAiSuggestedAction = crmContact ? crmContact.getString('ai_suggested_action') || '' : ''
      var crmAiPriority = crmContact ? crmContact.getInt('ai_priority') || 0 : 0

      // ---- Tom/orientacao por fase ----
      var toneGuidance = ''
      var phaseKey = ''

      var stageLower = crmStage.toLowerCase()
      if (crmCareStatus === 'nao_respondeu' || stageLower === 'nao_respondido') {
        phaseKey = 'reengajamento'
        toneGuidance =
          'REENGAJAMENTO: o contato nao respondeu ha algum tempo. Use um tom caloroso e breve, ' +
          'convidando a pessoa a retomar a conversa sem pressao. Nao insista em agendamento agora.'
      } else if (crmCareStatus === 'precisa_retorno') {
        phaseKey = 'retorno_urgente'
        toneGuidance =
          'RETORNO URGENTE: o contato precisa de retorno. Lembre-o com urgencia adequada (sem alarmismo) ' +
          'da importancia de retornar/agendar. Seja objetivo e ofereca horarios concretos.'
      } else if (
        stageLower === 'em atendimento' ||
        stageLower === 'em_atendimento' ||
        crmCareStatus === 'precisa_consulta' ||
        crmCareStatus === 'precisa_atencao'
      ) {
        phaseKey = 'em_atendimento'
        toneGuidance =
          'EM ATENDIMENTO: o contato esta em atendimento ou precisa de consulta. Incentive o ' +
          'agendamento, oferea informacoes sobre o servico e esclareca duvidas. Tom proativo e acolhedor.'
      } else if (stageLower === 'cliente' || crmAiSuggestedAction) {
        phaseKey = 'pos_consulta'
        var daysSinceConverted = ''
        if (crmConvertedAt) {
          try {
            var convDate = new Date(crmConvertedAt + 'T00:00:00Z')
            var diffMs = Date.now() - convDate.getTime()
            var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
            if (diffDays >= 0) daysSinceConverted = String(diffDays)
          } catch (_) {}
        }
        toneGuidance =
          'POS-CONSULTA: o contato ja e cliente/paciente. Faca um follow-up personalizado' +
          (daysSinceConverted ? ' (ultima consulta ha ' + daysSinceConverted + ' dias)' : '') +
          '. Pergunte como esta, se ha duvidas ou dificuldades, e sugira retorno se for o caso.'
      } else {
        phaseKey = isNewLead ? 'lead_novo' : 'lead_qualificacao'
        toneGuidance = isNewLead
          ? 'LEAD NOVO / PRIMEIRO CONTATO: aja como secretária acolhedora e atenta. Faca boas-vindas, ' +
            'apresente-se com carinho, esclareca duvidas sobre os servicos e conduza ao agendamento.'
          : 'LEAD / QUALIFICACAO: o contato ainda nao e paciente. Conduza com perguntas ' +
            'atenciosas e incentive o agendamento de uma primeira consulta.'
      }

      var crmContextBlock = '\n\n[CONTEXTO DO CONTATO NO CRM]'
      crmContextBlock += '\nNome do contato / Paciente: ' + contactName
      crmContextBlock += '\nTelefone / WhatsApp: ' + contactPhone
      crmContextBlock += '\nFase do pipeline: ' + (crmStage || 'nao definido')
      crmContextBlock += '\nStatus de cuidado: ' + (crmCareStatus || 'nao definido')
      crmContextBlock += '\nData da ultima consulta: ' + (crmConvertedAt || 'sem registro')
      if (crmAiSuggestedAction) {
        var isContaminatedAction =
          crmAiSuggestedAction.indexOf('Edvan') !== -1 ||
          crmAiSuggestedAction.indexOf('Elayne') !== -1 ||
          crmAiSuggestedAction.indexOf('Elaine') !== -1
        if (!isContaminatedAction) {
          crmContextBlock += '\nAcao sugerida anteriormente: ' + crmAiSuggestedAction
        }
      }
      if (crmAiPriority > 0) {
        crmContextBlock += '\nPrioridade IA: ' + crmAiPriority + ' (1-10)'
      }
      crmContextBlock += '\nOrientacao de tom para esta fase (' + phaseKey + '): ' + toneGuidance
      crmContextBlock +=
        '\nDISCIPLINA DE RESPOSTA E RITMO:\n' +
        '- Responda APENAS ao que foi perguntado na última mensagem do paciente.\n' +
        '- NÃO ofereça horários, datas ou disponibilidade de agenda — a agenda real da clínica NÃO é conhecida aqui.\n' +
        '- Se o paciente pedir agendamento, acolha com carinho e diga que vai confirmar os horários com o Dr. Caio e já retorna ("Deixa eu confirmar aqui os horários com o Dr. Caio e já te retorno, tá bom? 😊").\n' +
        '- SÓ mencione endereço/local se o paciente perguntou expressamente onde fica. NUNCA envie endereço antes da hora.\n' +
        '- Uma mensagem = um assunto. Nunca empilhe múltiplos tópicos.'
      crmContextBlock +=
        '\nIMPORTANTE: Este atendimento e EXCLUSIVO para "' +
        contactName +
        '" (' +
        contactPhone +
        '). NUNCA use nomes de outras pessoas, pacientes anteriores ou assuntos de outros atendimentos. Use apenas o historico real abaixo.'
      crmContextBlock += '\n[ FIM DO CONTEXTO DO CONTATO ]'

      // ---- HISTÓRICO REAL DA CONVERSA DESTE CONTATO ----
      // Busca até 15 mensagens anteriores deste contato estrito (remote_jid + instance_name)
      // para que o modelo tenha o fio da conversa e nunca alucine nomes ou assuntos alheios.
      var historyBlock = ''
      try {
        var recentHistory = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && id != {:curId}',
          '-timestamp',
          15,
          0,
          { jid: remoteJid, inst: instanceName, curId: msg.id },
        )

        if (recentHistory && recentHistory.length > 0) {
          // Ordena cronologicamente (mais antiga para mais recente)
          recentHistory.reverse()
          var historyLines = []
          for (var h = 0; h < recentHistory.length; h++) {
            var hMsg = recentHistory[h]
            var hContent = hMsg.getString('content') || ''
            var hTrans = hMsg.getString('transcription') || ''
            // Se tiver transcrição de áudio e conteúdo vazio, usa a transcrição
            if (
              (!hContent || hContent.startsWith('[audio') || hContent.startsWith('[Áudio')) &&
              hTrans &&
              hTrans !== 'SKIP_NO_TRANSCRIBE'
            ) {
              hContent = '[Áudio transcrito]: ' + hTrans
            }
            if (!hContent) continue
            var senderLabel = hMsg.getBool('from_me')
              ? 'Atendente/Fabiana'
              : 'Paciente (' + contactName + ')'
            historyLines.push('- ' + senderLabel + ': ' + hContent.trim())
          }
          if (historyLines.length > 0) {
            historyBlock =
              '\n\n[HISTÓRICO RECENTE DA CONVERSA DESTE CONTATO]\n' +
              historyLines.join('\n') +
              '\n[FIM DO HISTÓRICO]'
          }
        }
      } catch (histErr) {
        $app
          .logger()
          .error('cron_ai: error fetching conversation history', 'error', String(histErr))
      }

      var textContent = msg.getString('content') || ''
      var msgTrans = msg.getString('transcription') || ''
      if (
        (!textContent || textContent.startsWith('[audio') || textContent.startsWith('[Áudio')) &&
        msgTrans &&
        msgTrans !== 'SKIP_NO_TRANSCRIBE'
      ) {
        textContent = '[Áudio transcrito]: ' + msgTrans
      }
      if (!textContent) textContent = 'Mensagem em formato de midia.'

      var leadContext = crmContextBlock

      var finalMessage =
        '<system_instruction>\nSiga estritamente esta Persona/Instrucao:\n' +
        userAgentPrompt +
        '\n</system_instruction>' +
        leadContext +
        documentContext +
        historyBlock +
        '\n\n[NOVA MENSAGEM RECEBIDA DO PACIENTE ' +
        contactName.toUpperCase() +
        ']:\n' +
        textContent

      // ISOLAMENTO DE SESSÃO: Garante conversation_id exclusivo por conversa
      // ISOLAMENTO DE SESSÃO: Garante conversation_id exclusivo por conversa
      var aiConvId = conv.getString('ai_conversation_id') || ''
      try {
        var agentConv = $ai.agent('whatsapp-manager').getOrCreateConversation({
          user_id: userId,
          id: aiConvId || null,
          title: 'WhatsApp: ' + contactName + ' (' + contactPhone + ')',
        })
        if (agentConv && agentConv.id) {
          aiConvId = agentConv.id
          if (conv.getString('ai_conversation_id') !== aiConvId) {
            conv.set('ai_conversation_id', aiConvId)
            try {
              $app.save(conv)
            } catch (_) {}
          }
        }
      } catch (getConvErr) {
        $app.logger().warn('cron_ai: getOrCreateConversation fallback', 'error', String(getConvErr))
      }

      $app
        .logger()
        .info(
          'cron_ai: prompt dispatch',
          'contact',
          contactName,
          'phone',
          contactPhone,
          'remote_jid',
          remoteJid,
          'conv_id',
          aiConvId,
        )

      var result
      try {
        result = $ai.agent('whatsapp-manager').chat({
          user_id: userId,
          conversation_id: aiConvId || null,
          message: finalMessage,
        })
      } catch (err) {
        $app.logger().error('cron_ai: agent chat failed', 'error', String(err))
        msg.set('ai_response_error', String(err.message || err).substring(0, 1000))
        return false
      }

      if (!conv.getString('ai_conversation_id') && result && result.conversation_id) {
        conv.set('ai_conversation_id', result.conversation_id)
        try {
          $app.save(conv)
        } catch (_) {}
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

      if (isNightShieldActive()) {
        $app
          .logger()
          .info(
            'cron_ai: processAiResponse skip por Night Shield (21h-07h de Brasília) — mensagem continua pendente',
            'msg_id',
            msg.id,
          )
        return false
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
        timeout: 8,
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
            timeout: 8,
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
              timeout: 8,
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

      if (isNightShieldActive()) {
        $app
          .logger()
          .info(
            'cron_ai: sendOrientation skip por Night Shield (21h-07h de Brasília) — mensagem continua pendente',
            'msg_id',
            msg.id,
          )
        return false
      }

      var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
      var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
      var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
      if (!apiUrl || !evApiKey) return false

      var evolutionNumber = remoteJid.split('@')[0]
      var accountId = msg.getString('account_id')
      var crmContact = null
      try {
        crmContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: instanceName, jid: remoteJid },
        )
      } catch (_) {}

      var rawName = ''
      if (crmContact) {
        rawName = crmContact.getString('contact_name') || crmContact.getString('push_name') || ''
      }
      if (!rawName) {
        rawName = msg.getString('push_name') || ''
      }
      var lowerR = rawName.toLowerCase().trim()
      var isSelf =
        lowerR === 'você' ||
        lowerR === 'voce' ||
        lowerR === 'assistente' ||
        lowerR === 'dr. caio' ||
        lowerR === 'dr caio' ||
        (lowerR.indexOf('fabiana') !== -1 && lowerR.indexOf('assistente') !== -1)
      var cNameGreeting = !isSelf && rawName.trim() ? ' ' + rawName.trim() : ''

      var orientationText =
        'Olá' +
        cNameGreeting +
        '! Recebemos sua mensagem. Nosso atendimento humano está em pausa de almoço e retornará em breve. Obrigado pela paciência! 🙏'

      var sendRes = $http.send({
        url: apiUrl + '/message/sendText/' + instanceName,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evApiKey },
        body: JSON.stringify({ number: evolutionNumber, text: orientationText }),
        timeout: 8,
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
      var msgAccountId = msg.getString('account_id')

      if (msg.getBool('from_me') || remoteJid.endsWith('@g.us')) {
        msg.set('pending_ai_response', false)
        $app.saveNoValidate(msg)
        continue
      }

      // NIGHT SHIELD: entre 21h e 07h de Brasília, pular envio mantendo pendente
      if (isNightShieldActive()) {
        $app
          .logger()
          .info(
            'Envio adiado: Night Shield ativo (21h-07h de Brasília)',
            'cron',
            'cron_ai_delayed_response',
            'msg_id',
            msg.id,
          )
        continue
      }

      // KILL SWITCH GLOBAL: se automações pausadas, NUNCA disparar e manter mensagem pendente
      if (isGlobalAutomationsPaused(msgAccountId)) {
        $app
          .logger()
          .info(
            'Envio cancelado: automações globais pausadas',
            'cron',
            'cron_ai_delayed_response',
            'msg_id',
            msg.id,
          )
        continue
      }

      // Respeita os períodos de silêncio configurados pela conta: se o
      // horário atual está silenciado, NÃO dispara a IA nem a orientação
      // automática. A mensagem permanece pendente para ser processada
      // quando o silêncio terminar.
      if (isAccountSilenced(msgAccountId)) {
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
  } catch (fatalErr) {
    $app.logger().error('cron_ai_delayed_fatal', 'error', String(fatalErr))
  }
})
