/// <reference path="../pb_data/types.d.ts" />
routerAdd(
  'POST',
  '/backend/v1/conversations/suggest-reply',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const userId = e.auth?.id
      if (!userId) return e.unauthorizedError('auth required')

      const conversationId = body.conversation_id
      const remoteJid = body.remote_jid
      const instanceName = body.instance_name

      if (!conversationId && (!remoteJid || !instanceName)) {
        return e.badRequestError('conversation_id or (remote_jid + instance_name) is required')
      }

      var conv = null
      if (conversationId) {
        try {
          conv = $app.findRecordById('conversations', conversationId)
        } catch (_) {}
      }

      if (!conv && remoteJid && instanceName) {
        try {
          conv = $app.findFirstRecordByFilter(
            'conversations',
            'remote_jid = {:jid} && instance_name = {:instance}',
            { jid: remoteJid, instance: instanceName },
          )
        } catch (_) {}
      }

      if (!conv) {
        return e.notFoundError('conversation not found')
      }

      var effRemoteJid = conv.getString('remote_jid')
      var effInstanceName = conv.getString('instance_name')
      var accountId = conv.getString('account_id')

      // Identifica o agente Fabiana IA da conta ou geral
      var agentRecord = null
      if (conv.getString('ai_agent_id')) {
        try {
          agentRecord = $app.findRecordById('ai_agents', conv.getString('ai_agent_id'))
        } catch (_) {}
      }

      if (!agentRecord && accountId) {
        try {
          agentRecord = $app.findFirstRecordByFilter(
            'ai_agents',
            'name = {:name} && account_id = {:aid}',
            { name: 'Fabiana IA', aid: accountId },
          )
        } catch (_) {}
      }

      if (!agentRecord) {
        try {
          agentRecord = $app.findFirstRecordByFilter('ai_agents', 'name = {:name}', {
            name: 'Fabiana IA',
          })
        } catch (_) {}
      }

      var userAgentPrompt = ''
      if (agentRecord) {
        userAgentPrompt = agentRecord.getString('system_prompt')
      }

      // Contexto CRM do contato
      var crmContact = null
      try {
        crmContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'instance_name = {:inst} && jid = {:jid}',
          { inst: effInstanceName, jid: effRemoteJid },
        )
      } catch (_) {}

      var rawContactName = ''
      if (crmContact) {
        rawContactName =
          crmContact.getString('contact_name') || crmContact.getString('push_name') || ''
      }
      if (!rawContactName && conv) {
        rawContactName = conv.getString('contact_name') || conv.getString('push_name') || ''
      }

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
      var contactPhone = effRemoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '')

      var crmStage = crmContact ? crmContact.getString('stage') || '' : ''
      var crmCareStatus = crmContact ? crmContact.getString('care_status') || '' : ''
      var crmConvertedAt = crmContact ? crmContact.getString('converted_at') || '' : ''
      var crmAiSuggestedAction = crmContact ? crmContact.getString('ai_suggested_action') || '' : ''
      var crmAiPriority = crmContact ? crmContact.getInt('ai_priority') || 0 : 0

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

      // Histórico das 15 mensagens mais recentes
      var historyBlock = ''
      var lastIncomingText = ''
      try {
        var recentHistory = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst}',
          '-timestamp',
          15,
          0,
          { jid: effRemoteJid, inst: effInstanceName },
        )

        if (recentHistory && recentHistory.length > 0) {
          // A última recebida
          for (var k = 0; k < recentHistory.length; k++) {
            if (!recentHistory[k].getBool('from_me')) {
              var t = recentHistory[k].getString('content') || ''
              var tr = recentHistory[k].getString('transcription') || ''
              if (
                (!t || t.startsWith('[audio') || t.startsWith('[Áudio')) &&
                tr &&
                tr !== 'SKIP_NO_TRANSCRIBE'
              ) {
                t = '[Áudio transcrito]: ' + tr
              }
              if (t) {
                lastIncomingText = t
                break
              }
            }
          }

          recentHistory.reverse()
          var historyLines = []
          for (var h = 0; h < recentHistory.length; h++) {
            var hMsg = recentHistory[h]
            var hContent = hMsg.getString('content') || ''
            var hTrans = hMsg.getString('transcription') || ''
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
        $app.logger().error('suggest_reply: error fetching history', 'error', String(histErr))
      }

      if (!lastIncomingText) {
        lastIncomingText = 'Olá, gostaria de informações sobre o atendimento.'
      }

      var finalMessage =
        '<system_instruction>\nSiga estritamente esta Persona/Instrucao:\n' +
        userAgentPrompt +
        '\n</system_instruction>' +
        crmContextBlock +
        historyBlock +
        '\n\n[NOVA MENSAGEM RECEBIDA DO PACIENTE ' +
        contactName.toUpperCase() +
        ']:\n' +
        lastIncomingText +
        '\n\nGere a melhor sugestão de resposta para a Fabiana humana enviar neste momento, seguindo o ritmo acolhedor, respondendo APENAS ao que foi perguntado e sem inventar disponibilidade de agenda.'

      // Isolamento de sessão por contato
      var aiConvId = conv.getString('ai_conversation_id') || ''
      try {
        var agentConv = $ai.agent('fabiana-ia').getOrCreateConversation({
          user_id: userId,
          id: aiConvId || null,
          title: 'Sugestão: ' + contactName + ' (' + contactPhone + ')',
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
      } catch (convErr) {
        $app
          .logger()
          .warn('suggest_reply: getOrCreateConversation fallback', 'error', String(convErr))
      }

      var result = $ai.agent('fabiana-ia').chat({
        user_id: userId,
        conversation_id: aiConvId || null,
        message: finalMessage,
      })

      var suggestedReply = (result && result.content ? result.content : '').trim()

      // Limpa tags eventuais de [ENVIAR_DOCUMENTO:xxx]
      if (suggestedReply) {
        suggestedReply = suggestedReply.replace(/\[ENVIAR_DOCUMENTO:[^\]]+\]/g, '').trim()
      }

      return e.json(200, {
        conversation_id: conv.id,
        contact_name: contactName,
        suggestion: suggestedReply,
        ai_conversation_id: aiConvId,
      })
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'IA temporariamente indisponível' })
      }
      if (err instanceof SkipAiAgentsError) {
        const status = err.status || 500
        return e.json(status, { error: status >= 500 ? 'Falha no agente Fabiana IA' : err.message })
      }
      if (err instanceof SkipAiError) {
        const status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'IA temporariamente indisponível' : err.message,
        })
      }
      $app.logger().error('suggest_reply unexpected error', 'error', String(err))
      return e.json(500, {
        error: 'Erro ao gerar sugestão de resposta: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)
