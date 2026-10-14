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

      $app
        .logger()
        .info(
          'suggest_reply request received',
          'conversation_id',
          conversationId,
          'remote_jid',
          remoteJid,
          'instance_name',
          instanceName,
          'user_id',
          userId,
        )

      var conv = null
      if (conversationId) {
        try {
          conv = $app.findRecordById('conversations', conversationId)
        } catch (errFindId) {
          $app
            .logger()
            .warn(
              'suggest_reply findRecordById failed',
              'conversation_id',
              conversationId,
              'error',
              String(errFindId),
            )
        }
      }

      if (!conv && remoteJid && instanceName) {
        try {
          conv = $app.findFirstRecordByFilter(
            'conversations',
            'remote_jid = {:jid} && instance_name = {:instance}',
            { jid: remoteJid, instance: instanceName },
          )
        } catch (errFilter) {
          $app
            .logger()
            .warn(
              'suggest_reply findFirstRecordByFilter failed',
              'remote_jid',
              remoteJid,
              'instance_name',
              instanceName,
              'error',
              String(errFilter),
            )
        }
      }

      if (!conv) {
        $app
          .logger()
          .warn(
            'suggest_reply conversation not found',
            'conversation_id',
            conversationId,
            'remote_jid',
            remoteJid,
            'instance_name',
            instanceName,
          )
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

      // Buscar templates oficiais da conta marcados como "Voz da Fabiana" (tom acolhedor, clareza clínica e fechamento humanizado)
      var fabianaVoiceBlock = ''
      try {
        var tplFilter = 'is_fabiana_voice = true'
        if (accountId) {
          tplFilter += ' && account_id = "' + accountId + '"'
        }
        var fabianaTemplates = $app.findRecordsByFilter(
          'message_templates',
          tplFilter,
          '-updated',
          8,
        )
        if (fabianaTemplates && fabianaTemplates.length > 0) {
          var tplExamples = []
          for (var ti = 0; ti < fabianaTemplates.length; ti++) {
            var tContent = fabianaTemplates[ti].getString('content')
            var tTitle = fabianaTemplates[ti].getString('title')
            if (tContent && tContent.trim()) {
              tplExamples.push(
                '- [' + (tTitle || 'Padrão Fabiana') + ']: "' + tContent.trim() + '"',
              )
            }
          }
          if (tplExamples.length > 0) {
            fabianaVoiceBlock =
              '\n\n[EXEMPLOS DO TOM E REPERTÓRIO OFICIAL DA SECRETÁRIA FABIANA]\n' +
              'Use estes modelos reais cadastrados na clínica para guiar o estilo: saudações acolhedoras, clareza clínica empática e fechamento humanizado:\n' +
              tplExamples.join('\n') +
              '\n[FIM DOS EXEMPLOS DA VOZ DA FABIANA]'
          }
        }
      } catch (voiceErr) {
        $app
          .logger()
          .warn('suggest_reply: failed to load fabiana voice templates', 'error', String(voiceErr))
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
        '- SÓ mencione endereço/local se o paciente perguntou expressamente onde fica. NUNCA envie endereço antes da hora.\n' +
        '- Uma mensagem = um assunto. Nunca empilhe múltiplos tópicos.'
      crmContextBlock +=
        '\nIMPORTANTE: Este atendimento e EXCLUSIVO para "' +
        contactName +
        '" (' +
        contactPhone +
        '). NUNCA use nomes de outras pessoas, pacientes anteriores ou assuntos de outros atendimentos. Use apenas o historico real abaixo.'
      crmContextBlock += '\n[ FIM DO CONTEXTO DO CONTATO ]'

      // Contexto da Agenda Real (próximos agendamentos do paciente e slots ocupados do Dr. Caio)
      var agendaContextBlock = '\n\n[CONTEXTO DE AGENDA REAL]'
      try {
        var nowIso = new Date().toISOString()
        var sevenDaysLaterIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

        // 1. Agendamentos do paciente atual
        var patientAppointments = []
        var phoneDigits = contactPhone ? contactPhone.replace(/\D/g, '') : ''
        var phoneSuffix = phoneDigits && phoneDigits.length >= 8 ? phoneDigits.slice(-8) : ''

        var patientFilter = 'status != "cancelado" && starts_at >= {:now}'
        var patientParams = { now: nowIso }
        if (crmContact && crmContact.id) {
          patientFilter += ' && (patient_id = {:pid} || patient_phone ~ {:suf})'
          patientParams.pid = crmContact.id
          patientParams.suf = phoneSuffix || contactPhone
        } else if (phoneSuffix) {
          patientFilter += ' && patient_phone ~ {:suf}'
          patientParams.suf = phoneSuffix
        } else {
          patientFilter += ' && patient_name ~ {:name}'
          patientParams.name = contactName
        }

        try {
          patientAppointments = $app.findRecordsByFilter(
            'appointments',
            patientFilter,
            '+starts_at',
            5,
            0,
            patientParams,
          )
        } catch (_) {}

        if (patientAppointments && patientAppointments.length > 0) {
          agendaContextBlock += '\nAgendamentos futuros deste paciente:'
          for (var pa = 0; pa < patientAppointments.length; pa++) {
            var pApp = patientAppointments[pa]
            agendaContextBlock +=
              '\n- ' +
              pApp.getString('starts_at') +
              ' | ' +
              pApp.getString('city') +
              ' (' +
              (pApp.getString('location') || 'Clínica') +
              ') | Tipo: ' +
              (pApp.getString('appointment_type') || 'Consulta') +
              ' | Status: ' +
              pApp.getString('status')
          }
        } else {
          agendaContextBlock +=
            '\nAgendamentos futuros deste paciente: Nenhum agendamento futuro encontrado.'
        }

        // 2. Slots ocupados do Dr. Caio nos próximos 7 dias por cidade
        var busySlots = []
        try {
          busySlots = $app.findRecordsByFilter(
            'appointments',
            'status != "cancelado" && starts_at >= {:now} && starts_at <= {:limit}',
            '+starts_at',
            30,
            0,
            { now: nowIso, limit: sevenDaysLaterIso },
          )
        } catch (_) {}

        if (busySlots && busySlots.length > 0) {
          agendaContextBlock += '\nAgenda do Dr. Caio nos próximos 7 dias (horários já OCUPADOS):'
          for (var bs = 0; bs < busySlots.length; bs++) {
            var bApp = busySlots[bs]
            agendaContextBlock +=
              '\n- Ocupado: ' +
              bApp.getString('starts_at') +
              ' até ' +
              bApp.getString('ends_at') +
              ' em ' +
              bApp.getString('city') +
              ' (' +
              (bApp.getString('location') || '') +
              ')'
          }
        } else {
          agendaContextBlock +=
            '\nAgenda do Dr. Caio nos próximos 7 dias: Nenhum agendamento sincronizado ou agenda ainda vazia.'
        }

        agendaContextBlock +=
          '\nDIRETRIZ DE AGENDAMENTO COM A AGENDA REAL:\n' +
          '- NUNCA invente horários ou dias do nada.\n' +
          '- Se a agenda estiver vazia ou sem horários sincronizados: mantenha a postura segura clássica: "Deixa eu confirmar aqui certinho com o Dr. Caio os horários disponíveis e já te passo, tá bom? 😊".\n' +
          '- Se houver agenda real sincronizada e o paciente solicitar agendamento em uma cidade específica, você pode oferecer 2 opções REAIS disponíveis baseadas nos dias/turnos em que o Dr. Caio atende naquela cidade (Carmo: Climed; Alfenas: terças e sextas à tarde no Instituto Harmoniza; Monte Belo: quartas-feiras), respeitando estritamente os horários já OCUPADOS acima (não marcar em horário ocupado).\n' +
          '- Se o paciente já tiver consulta marcada, reconheça o agendamento existente ao responder.'
      } catch (agendaErr) {
        agendaContextBlock +=
          '\nAgenda: consulta indisponível momentaneamente. Confirme com o Dr. Caio.'
      }
      agendaContextBlock += '\n[FIM DO CONTEXTO DE AGENDA]'

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
        '\n\nDIRETRIZES DA VOZ DA FABIANA:\n' +
        '- Saudações acolhedoras, calorosas e educadas, transmitindo segurança e cuidado clínico.\n' +
        '- Clareza clínica com empatia: orientar sobre consultas, retornos e valores com total transparência.\n' +
        '- Fechamento humanizado e atencioso.\n' +
        '- Esta resposta é sempre um RASCUNHO que a atendente humana irá revisar antes de enviar via WhatsApp.\n' +
        '</system_instruction>' +
        fabianaVoiceBlock +
        crmContextBlock +
        agendaContextBlock +
        historyBlock +
        '\n\n[NOVA MENSAGEM RECEBIDA DO PACIENTE ' +
        contactName.toUpperCase() +
        ']:\n' +
        lastIncomingText +
        '\n\nGere a melhor sugestão de resposta em formato de rascunho com a Voz da Fabiana para a atendente humana aprovar e enviar neste momento, seguindo o ritmo acolhedor, respondendo APENAS ao que foi perguntado e sem inventar disponibilidade de agenda.'

      // Isolamento de sessão por contato
      var aiConvId = conv.getString('ai_conversation_id') || ''
      if (aiConvId) {
        try {
          var agentConv = $ai.agent('fabiana-ia').getOrCreateConversation({
            user_id: userId,
            id: aiConvId,
            title: 'Sugestão: ' + contactName + ' (' + contactPhone + ')',
          })
          if (agentConv && agentConv.id) {
            aiConvId = agentConv.id
          }
        } catch (convErr) {
          $app
            .logger()
            .warn(
              'suggest_reply: existing conversation lookup failed, resetting conversation_id',
              'error',
              String(convErr),
            )
          aiConvId = ''
        }
      }

      if (!aiConvId) {
        try {
          var newAgentConv = $ai.agent('fabiana-ia').getOrCreateConversation({
            user_id: userId,
            title: 'Sugestão: ' + contactName + ' (' + contactPhone + ')',
          })
          if (newAgentConv && newAgentConv.id) {
            aiConvId = newAgentConv.id
            conv.set('ai_conversation_id', aiConvId)
            try {
              $app.save(conv)
            } catch (saveErr) {
              $app
                .logger()
                .warn(
                  'suggest_reply: failed to persist ai_conversation_id on conv',
                  'error',
                  String(saveErr),
                )
            }
          }
        } catch (newConvErr) {
          $app
            .logger()
            .warn('suggest_reply: create fresh conversation failed', 'error', String(newConvErr))
          aiConvId = ''
        }
      }

      var result = null
      try {
        result = $ai.agent('fabiana-ia').chat({
          user_id: userId,
          conversation_id: aiConvId || null,
          message: finalMessage,
        })
      } catch (chatErr) {
        // Se falhar com "conversation not found" (ex.: ai_conversation_id pertence a outro user_id ou ficou corrompida), tenta chat sem conversation_id
        if (
          aiConvId &&
          (chatErr instanceof SkipAiAgentsError || String(chatErr).indexOf('conversation') !== -1)
        ) {
          $app
            .logger()
            .warn(
              'suggest_reply: retry chat without conversation_id after error',
              'error',
              String(chatErr),
            )
          result = $ai.agent('fabiana-ia').chat({
            user_id: userId,
            conversation_id: null,
            message: finalMessage,
          })
          if (result && result.conversation_id) {
            aiConvId = result.conversation_id
            conv.set('ai_conversation_id', aiConvId)
            try {
              $app.save(conv)
            } catch (_) {}
          }
        } else {
          throw chatErr
        }
      }

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
      $app
        .logger()
        .error(
          'suggest_reply caught error in handler',
          'error',
          String(err),
          'stack',
          err?.stack || '',
        )
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'IA temporariamente indisponível' })
      }
      if (err instanceof SkipAiAgentsError) {
        const status = err.status || 500
        // Se for 404 de dentro do agente (ex: conversation/user miss), retornar mensagem explicativa
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
