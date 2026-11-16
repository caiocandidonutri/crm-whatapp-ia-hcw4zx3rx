// ============================================================================
// LOOP DO LEAD — CRON DE EXECUÇÃO (a cada 5 min)
//   1. Resposta da IA ao lead novo ~2 min após o gatilho (ia_lead_pending_reply).
//   2. Follow-up a cada 3h se o lead não respondeu.
//   3. Nunca envia entre 00h–04h (sem follow-up) nem no Night Shield 21h–07h.
//   4. Fabiana humana de plantão (07h–17h): IA não assume lead novo; follow-up
//      do lead que chegou fora do plantão roda normalmente.
//   5. Kill-switch global respeitado em TODOS os envios.
// Envio pelo mesmo caminho do cron de IA: $ai.agent('whatsapp-manager') →
// Evolution sendText → outbox_marks origin 'ia' → msg local from_me 'Assistente'.
// Créditos OpenAI esgotados: $ai.agent lança erro → degrada sem quebrar
// (máx. 3 tentativas, depois contato sai do 'pending' e é reavaliado depois).
// IMPORTANTE (JSVM do PocketBase): TODA função/constante vive DENTRO do
// callback do cron — nada no topo do arquivo (hook scoping error).
// ZERO deletes. Kill-switch global respeitado.
// ============================================================================

cronAdd('ia_lead_loop_cron', '*/5 * * * *', function () {
  try {
    // ---------- helpers (todos inline) ----------
    var brazilHour = function () {
      return new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
    }
    var isNightShieldActive = function () {
      var h = brazilHour()
      return h >= 21 || h < 7
    }
    var isNoFollowupWindow = function () {
      // (4) Entre 00h e 04h: sem follow-up (recepcionar ok = só acolhimento)
      var h = brazilHour()
      return h >= 0 && h < 4
    }
    var isFabianaHumanShift = function () {
      // (5) Fabiana humana atende 07h–17h
      return brazilHour() >= 7 && brazilHour() < 17
    }
    var isGlobalAutomationsPaused = function (accountId) {
      try {
        var filter = 'global_automations_paused = true'
        if (accountId) {
          filter = 'account_id = "' + accountId + '" && global_automations_paused = true'
        }
        $app.findFirstRecordByFilter('care_alert_settings', filter)
        return true
      } catch (_) {
        return false
      }
    }
    // ---------- TRIAGEM DO LEAD (campos da migration 1740000211) ----------
    // Estado da triagem vive em crm_contacts.ia_lead_triagem_json:
    //   { etapa, queixa, tempo, modalidade, periodo, pronto, fail_count,
    //     last_attempt_ts, updated_at }
    var parseTriagem = function (contact) {
      var t = {
        etapa: 'queixa',
        queixa: '',
        tempo: '',
        modalidade: '',
        periodo: '',
        pronto: false,
        fail_count: 0,
        last_attempt_ts: 0,
        updated_at: '',
      }
      try {
        var raw = contact.get('ia_lead_triagem_json')
        if (raw) {
          var obj = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (obj && typeof obj === 'object') {
            var keys = ['etapa', 'queixa', 'tempo', 'modalidade', 'periodo', 'updated_at']
            for (var k = 0; k < keys.length; k++) {
              if (obj[keys[k]] !== undefined && obj[keys[k]] !== null)
                t[keys[k]] = String(obj[keys[k]])
            }
            if (obj.pronto === true) t.pronto = true
            if (typeof obj.fail_count === 'number') t.fail_count = obj.fail_count
            if (typeof obj.last_attempt_ts === 'number') t.last_attempt_ts = obj.last_attempt_ts
          }
        }
      } catch (_) {}
      if (!t.etapa) t.etapa = 'queixa'
      return t
    }
    var saveTriagem = function (contact, t) {
      t.updated_at = new Date().toISOString()
      contact.set('ia_lead_triagem_json', JSON.stringify(t))
    }
    // A pergunta pendente SEMPRE é a próxima pendente — o follow-up retoma daqui,
    // nunca recomeça do zero.
    var nextTriagemQuestion = function (t) {
      if (!t.queixa)
        return 'Qual é a sua principal queixa hoje — o que você está sentindo ou buscando com o acompanhamento?'
      if (!t.modalidade) return 'Você prefere o atendimento presencial, aqui na clínica, ou online?'
      if (!t.periodo) return 'E qual o melhor período do dia para você — manhã, tarde ou noite?'
      return null
    }
    // Extração determinística (regex inline, sem custo de IA): modalidade,
    // período e "há quanto tempo" espontâneo. A queixa é a resposta textual à
    // pergunta da queixa (guardada inteira, com teto de 300 chars).
    var extractTriagem = function (rawContent, t) {
      var text = String(rawContent || '').toLowerCase()
      if (!t.modalidade) {
        if (/presencial|na cl[ií]nica|na clinica|pessoalmente|\bpessoal\b/.test(text)) {
          t.modalidade = 'presencial'
        } else if (/online|v[ií]deo|virtua|por chamada|whats ?app/.test(text)) {
          t.modalidade = 'online'
        }
      }
      if (!t.periodo) {
        var per = []
        if (/manh[ãa]/.test(text)) per.push('manhã')
        if (/tarde/.test(text)) per.push('tarde')
        if (/noite/.test(text)) per.push('noite')
        if (per.length > 0) t.periodo = per.join(' ou ')
      }
      if (!t.tempo) {
        var mTempo = text.match(/h[áa]\s+\d+\s+(anos?|meses|semanas|dias?)([^.,;!?]*)/)
        if (mTempo) t.tempo = mTempo[0].trim().substring(0, 60)
      }
      if (!t.queixa && t.etapa === 'queixa') {
        var stripped = text.replace(/[^a-zà-ú\s]/g, '').trim()
        var shortAnswers = [
          'presencial',
          'online',
          'manha',
          'manhã',
          'tarde',
          'noite',
          'de manha',
          'de manhã',
          'de tarde',
          'de noite',
          'a tarde',
          'à tarde',
          'a noite',
          'à noite',
          'pode ser online',
          'tanto faz',
          'qualquer',
        ]
        if (stripped && shortAnswers.indexOf(stripped) === -1) {
          t.queixa = String(rawContent || '')
            .trim()
            .substring(0, 300)
        }
      }
      // Avança para a PRÓXIMA pergunta pendente (não recomeça do zero).
      var nextEtapa = 'pronto'
      if (!t.queixa) nextEtapa = 'queixa'
      else if (!t.modalidade) nextEtapa = 'modalidade'
      else if (!t.periodo) nextEtapa = 'periodo'
      t.etapa = nextEtapa
      if (nextEtapa === 'pronto') t.pronto = true
      return t
    }

    var buildFabianaLeadPrompt = function (contact, msg, mode) {
      var contactName =
        contact.getString('contact_name') || contact.getString('push_name') || 'Paciente'
      var contactPhone = (contact.getString('jid') || '').replace('@s.whatsapp.net', '')
      var stage = contact.getString('ia_lead_stage') || ''

      var recentMsgs = []
      try {
        recentMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst}',
          '-timestamp',
          20,
          0,
          { jid: contact.getString('jid'), inst: contact.getString('instance_name') },
        )
      } catch (_) {}

      var historyLines = []
      for (var i = recentMsgs.length - 1; i >= 0; i--) {
        var m = recentMsgs[i]
        var c = m.getString('content') || ''
        if (!c) {
          // Áudio sem conteúdo legível usa a transcrição (fio da conversa)
          var mTrans = m.getString('transcription') || ''
          if (mTrans && mTrans !== 'SKIP_NO_TRANSCRIBE') c = '[Áudio transcrito]: ' + mTrans
        }
        if (!c) continue
        historyLines.push(
          '- ' +
            (m.getBool('from_me') ? 'Clínica (Fabiana)' : 'Lead (' + contactName + ')') +
            ': ' +
            c,
        )
      }
      var historyBlock = historyLines.length
        ? '\n\n[HISTÓRICO RECENTE DA CONVERSA — use este fio para entender perguntas de acompanhamento]\n' +
          historyLines.join('\n') +
          '\n[FIM DO HISTÓRICO]'
        : ''

      // Ficha de conhecimento da clínica (fatos aprovados: valores, formas de
      // pagamento, dias de atendimento) buscada por palavras-chave da conversa.
      var knowledgeBlock = ''
      try {
        var kbRecs = $app.findRecordsByFilter(
          'knowledge_base',
          'status = "aprovada"',
          '-updated',
          60,
          0,
        )
        if (kbRecs && kbRecs.length > 0) {
          var searchText =
            historyLines.join(' ') +
            ' ' +
            (msg && msg.getString('content') ? msg.getString('content') : '')
          var kbTerms = []
          var kbWords = searchText
            .toLowerCase()
            .replace(/[^a-z0-9à-ú\s]/g, ' ')
            .split(/\s+/)
          var kbStop =
            'a o e de da do das dos em no na nos nas um uma uns umas para por com sem que qual quais quando onde como você voce'
          var kbStopMap = {}
          var kbStopParts = kbStop.split(' ')
          for (var sw = 0; sw < kbStopParts.length; sw++) kbStopMap[kbStopParts[sw]] = true
          for (var kw = 0; kw < kbWords.length; kw++) {
            var kwWord = kbWords[kw]
            if (kwWord.length >= 3 && !kbStopMap[kwWord] && kbTerms.indexOf(kwWord) === -1) {
              kbTerms.push(kwWord)
            }
            if (kbTerms.length >= 15) break
          }
          var kbScored = []
          for (var kr = 0; kr < kbRecs.length; kr++) {
            var kbHay = (
              kbRecs[kr].getString('pergunta') +
              ' ' +
              kbRecs[kr].getString('titulo') +
              ' ' +
              kbRecs[kr].getString('resposta')
            ).toLowerCase()
            var kbScore = 0
            for (var kt = 0; kt < kbTerms.length; kt++) {
              if (kbHay.indexOf(kbTerms[kt]) !== -1) kbScore++
            }
            if (kbScore > 0) kbScored.push({ rec: kbRecs[kr], score: kbScore })
          }
          kbScored.sort(function (a, b) {
            return b.score - a.score
          })
          var kbLines = []
          var kbMax = kbScored.length < 5 ? kbScored.length : 5
          for (var kb = 0; kb < kbMax; kb++) {
            kbLines.push(
              '- ' +
                kbScored[kb].rec.getString('titulo') +
                ': ' +
                kbScored[kb].rec.getString('resposta'),
            )
          }
          if (kbLines.length > 0) {
            knowledgeBlock =
              '\n\n[FICHA DE CONHECIMENTO DA CLÍNICA — fatos aprovados pela equipe. Use como verdade; NÃO invente nada além deles]\n' +
              kbLines.join('\n') +
              '\n[FIM DA FICHA DE CONHECIMENTO]'
          }
        }
      } catch (kbErr) {
        $app.logger().warn('ia_lead_loop: knowledge_base error', 'err', String(kbErr))
      }

      var isFollowup = mode === 'followup'
      var isTriagem = mode === 'triagem'
      var followupCount = contact.getInt('ia_lead_followup_count') || 0

      // Estado da triagem + próxima pergunta pendente (uma pergunta por vez)
      var triagem = parseTriagem(contact)
      var pendQ = nextTriagemQuestion(triagem)
      var triagemBlock =
        '\n[TRIAGEM DO LEAD — dados coletados até agora]\n' +
        '- Queixa principal: ' +
        (triagem.queixa || '(ainda não informada)') +
        '\n' +
        '- Modalidade (presencial/online): ' +
        (triagem.modalidade || '(ainda não informada)') +
        '\n' +
        '- Período preferido: ' +
        (triagem.periodo || '(ainda não informado)') +
        '\n' +
        '- REGRA RÍGIDA: faça NO MÁXIMO UMA pergunta por mensagem (triagem sem bombardeio). ' +
        'Nunca pergunte algo que já está coletado acima.'

      var goal = ''
      if (isTriagem) {
        if (pendQ) {
          goal =
            'MODO: TRIAGEM DO LEAD — o lead acabou de responder. Acolha brevemente o que ele ' +
            'disse (1 frase, com empatia) e faça SOMENTE a próxima pergunta pendente da triagem:\n' +
            'PRÓXIMA PERGUNTA PENDENTE: "' +
            pendQ +
            '"\n' +
            'NÃO faça nenhuma outra pergunta nesta mensagem e não repita perguntas já respondidas.'
        } else {
          goal =
            'MODO: TRIAGEM COMPLETA (queixa, modalidade e período já coletados). NÃO faça mais ' +
            'perguntas de triagem. Agradeça o compartilhamento com calma, diga que a triagem ' +
            'está prontinha e que você já vai confirmar os horários com o Dr. Caio e já retorna.'
        }
      } else if (isFollowup) {
        if (pendQ) {
          goal =
            'MODO: FOLLOW-UP AUTOMÁTICO (~3h sem resposta do lead) — RETOMADA DE TRIAGEM. ' +
            'A triagem está INCOMPLETA: NÃO recomece do zero e NÃO repita perguntas já respondidas. ' +
            'Reabra com leveza e faça SOMENTE a próxima pergunta pendente:\n' +
            'PRÓXIMA PERGUNTA PENDENTE: "' +
            pendQ +
            '"\n' +
            'Este é o follow-up nº ' +
            (followupCount + 1) +
            '.'
        } else {
          goal =
            'MODO: FOLLOW-UP AUTOMÁTICO (lead não respondeu há ~3h). Envie uma mensagem CURTA, ' +
            'leve e sem cobrança — reabra a conversa com empatia e ofereça ajuda concreta. ' +
            'Este é o follow-up nº ' +
            (followupCount + 1) +
            '. Varie o texto em relação às mensagens anteriores (não repita a mesma frase).'
        }
      } else {
        goal =
          'MODO: PRIMEIRA RESPOSTA AO LEAD (veio de anúncio de tráfego pago). Acolha com ' +
          'calidez, agradeça o contato e faça SOMENTE A PRIMEIRA PERGUNTA DA TRIAGEM, com ' +
          'naturalidade: qual é a queixa principal (o que ele está sentindo ou buscando). ' +
          'Não pergunte mais nada nesta mensagem.'
      }

      var systemPrompt =
        'Você é a Fabiana, secretária da clínica de nutrição do Dr. Caio. Responda como ela.\n' +
        '\n[DIRETRIZES — LEAD DE TRÁFEGO PAGO]\n' +
        '- ' +
        goal +
        '\n' +
        '- CONVÊNIO: a clínica atende SÓ particular. Se o lead perguntar de convênio/plano,\n' +
        '  use o argumento de valor: atendimento humanizado, tempo de consulta estendido,\n' +
        '  plano alimentar individualizado e acompanhamento próximo — sem fila de espera.\n' +
        '- NÃO invente horários, preços fechados ou disponibilidade de agenda.\n' +
        '- MULTI-PERGUNTA: se a mensagem do lead tiver VÁRIAS perguntas, responda TODAS as partes, uma a uma.\n' +
        '- NUNCA INVENTE fatos concretos (valor exato, disponibilidade em data específica, cobertura de\n' +
        '  procedimento). Quando não tiver certeza pela ficha de conhecimento, diga que vai confirmar com o\n' +
        '  Dr. Caio/equipe e já retorna — a equipe é avisada automaticamente.\n' +
        '- Se o lead pedir agendamento, diga que vai confirmar os horários com o Dr. Caio e já retorna.\n' +
        '- Tom de acolhimento e cuidado; breve, sem texto corrido longo.\n' +
        '- NUNCA revele que é IA.\n' +
        '- TRIAGEM: faça UMA pergunta por vez, espere a resposta e só então faça a próxima.\n' +
        '  (1) qual é a principal queixa/motivo do contato; (2) prefere atendimento presencial ou\n' +
        '  online; (3) qual o melhor período do dia (manhã, tarde ou noite). Nunca mande as\n' +
        '  perguntas juntas numa única mensagem.\n' +
        '\n[CONTEXTO DO CONTATO]\nNome: ' +
        contactName +
        '\nTelefone: ' +
        contactPhone +
        '\nEstágio no CRM: ' +
        stage +
        triagemBlock

      var textContent = msg ? msg.getString('content') || '' : ''
      var transcription = msg ? msg.getString('transcription') || '' : ''
      if (
        (!textContent ||
          textContent.indexOf('[audio') === 0 ||
          textContent.indexOf('[Áudio') === 0) &&
        transcription &&
        transcription !== 'SKIP_NO_TRANSCRIBE'
      ) {
        textContent = '[Áudio transcrito]: ' + transcription
      }
      if (!textContent) textContent = 'Mensagem em formato de mídia.'

      return (
        systemPrompt +
        knowledgeBlock +
        historyBlock +
        '\n\n[ÚLTIMA MENSAGEM DO LEAD]:\n' +
        (isFollowup ? '(lead ficou em silêncio desde a última mensagem da clínica)' : textContent)
      )
    }
    var sendIaMessage = function (contact, text) {
      var apiUrlRaw = $secrets.get('EVOLUTION_API_URL') || ''
      var apiUrl = apiUrlRaw.endsWith('/') ? apiUrlRaw.slice(0, -1) : apiUrlRaw
      var evApiKey = $secrets.get('EVOLUTION_API_KEY') || ''
      if (!apiUrl || !evApiKey) {
        $app.logger().error('ia_lead_loop: Evolution credentials missing')
        return null
      }

      var remoteJid = contact.getString('jid')
      var instanceName = contact.getString('instance_name')
      var evolutionNumber = remoteJid.split('@')[0]
      var accountId = contact.getString('account_id')
      var nowTs = Math.floor(Date.now() / 1000)

      var sendRes = $http.send({
        url: apiUrl + '/message/sendText/' + instanceName,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evApiKey },
        body: JSON.stringify({ number: evolutionNumber, text: text }),
        timeout: 6,
      })

      if (sendRes.statusCode < 200 || sendRes.statusCode >= 300) {
        $app.logger().error('ia_lead_loop: Evolution sendText failed', 'status', sendRes.statusCode)
        return null
      }

      var sentMsgId = ''
      try {
        sentMsgId = sendRes.json && sendRes.json.key && sendRes.json.key.id
      } catch (_) {}
      if (!sentMsgId) sentMsgId = 'ia_lead_' + $security.randomString(16)

      // outbox_marks origin 'ia' ANTES de o webhook chegar (marca a msg como IA)
      try {
        var outboxCol = $app.findCollectionByNameOrId('outbox_marks')
        var markRec = new Record(outboxCol)
        markRec.set('message_id', String(sentMsgId).trim())
        markRec.set('origin', 'ia')
        $app.save(markRec)
      } catch (markErr) {
        $app.logger().warn('ia_lead_loop: outbox mark error', 'err', String(markErr))
      }

      var msgCol = $app.findCollectionByNameOrId('whatsapp_messages')
      var newMsg = new Record(msgCol)
      newMsg.set('user_id', contact.getString('user_id'))
      if (accountId) newMsg.set('account_id', accountId)
      newMsg.set('instance_name', instanceName)
      newMsg.set('remote_jid', remoteJid)
      newMsg.set('from_me', true)
      newMsg.set('origin', 'ia')
      newMsg.set('message_id', sentMsgId)
      newMsg.set('push_name', 'Assistente')
      newMsg.set('content', text)
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
        if (conv) {
          conv.set('last_message', text)
          conv.set('last_message_timestamp', nowTs)
          conv.set('unread_count', 0)
          $app.save(conv)
        }
      } catch (_) {}

      return sentMsgId
    }
    var callFabianaAi = function (contact, msg, mode, errorPrefix) {
      var userId = contact.getString('user_id')
      var prompt = buildFabianaLeadPrompt(contact, msg, mode)

      var aiConvId = ''
      try {
        var agentConv = $ai.agent('whatsapp-manager').getOrCreateConversation({
          user_id: userId,
          id: null,
          title: 'Lead tráfego pago: ' + (contact.getString('jid') || ''),
        })
        if (agentConv && agentConv.id) aiConvId = agentConv.id
      } catch (_) {}

      try {
        return $ai.agent('whatsapp-manager').chat({
          user_id: userId,
          conversation_id: aiConvId || null,
          message: prompt,
        })
      } catch (aiErr) {
        $app.logger().error(errorPrefix, 'err', String(aiErr))
        return null
      }
    }
    var processPendingReply = function (contact, nowTs) {
      var remoteJid = contact.getString('jid')
      var instanceName = contact.getString('instance_name')
      var triggerTs = contact.getInt('ia_lead_last_message_ts') || 0

      // Resposta da IA: ~2 min após o gatilho
      if (nowTs - triggerTs < 110) return

      var triggerMsg = null
      try {
        var recents = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName },
        )
        if (recents && recents.length > 0) triggerMsg = recents[0]
      } catch (_) {}

      // Já houve msg minha (humana ou IA) depois do gatilho? Loop já foi atendido.
      try {
        var laterMine = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts}',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName, ts: triggerTs },
        )
        if (laterMine && laterMine.length > 0) {
          contact.set('ia_lead_pending_reply', false)
          contact.set('ia_lead_stage', 'engaged')
          $app.saveNoValidate(contact)
          return
        }
      } catch (_) {}

      var result = callFabianaAi(contact, triggerMsg, 'first', 'ia_lead_loop: AI chat failed')
      if (!result) {
        // Degradação graciosa: tenta de novo no próximo tick, máx. 3 tentativas.
        var tries = (contact.getInt('ia_lead_retry_count') || 0) + 1
        contact.set('ia_lead_retry_count', tries)
        if (tries >= 3) {
          contact.set('ia_lead_pending_reply', false)
          contact.set('ia_lead_stage', 'engaged')
        }
        $app.saveNoValidate(contact)
        return
      }

      var replyText = result && result.content ? result.content.trim() : ''
      if (!replyText) {
        contact.set('ia_lead_pending_reply', false)
        $app.saveNoValidate(contact)
        return
      }

      var sentId = sendIaMessage(contact, replyText)
      if (!sentId) return // falhou o envio → tenta no próximo tick

      // Inicializa o estado da triagem (primeira pergunta: queixa principal)
      var tInit = parseTriagem(contact)
      if (!tInit.updated_at && !tInit.queixa && !tInit.pronto) {
        tInit.etapa = 'queixa'
        saveTriagem(contact, tInit)
      }
      contact.set('ia_lead_pending_reply', false)
      contact.set('ia_lead_stage', 'engaged')
      contact.set('ia_lead_retry_count', 0)
      contact.set('ia_lead_last_ai_reply_at', new Date().toISOString())
      $app.saveNoValidate(contact)
    }
    var processFollowup = function (contact, nowTs) {
      var remoteJid = contact.getString('jid')
      var instanceName = contact.getString('instance_name')

      var lastInboundTs = 0
      try {
        var recents = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName },
        )
        if (recents && recents.length > 0) lastInboundTs = recents[0].getInt('timestamp') || 0
      } catch (_) {}

      var lastAiReplyTs = 0
      try {
        var lastAi = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && origin = {:org}',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName, org: 'ia' },
        )
        if (lastAi && lastAi.length > 0) lastAiReplyTs = lastAi[0].getInt('timestamp') || 0
      } catch (_) {}

      // Fabiana humana respondeu depois da última msg recebida? Contato é dela.
      var humanAfter = false
      try {
        var h1 = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts} && origin = {:o}',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName, ts: lastInboundTs, o: 'humano_celular' },
        )
        if (h1 && h1.length > 0) humanAfter = true
      } catch (_) {}
      if (!humanAfter) {
        try {
          var h2 = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst} && from_me = true && timestamp > {:ts} && origin = {:o}',
            '-timestamp',
            1,
            0,
            { jid: remoteJid, inst: instanceName, ts: lastInboundTs, o: 'humano_crm' },
          )
          if (h2 && h2.length > 0) humanAfter = true
        } catch (_) {}
      }
      if (humanAfter) {
        contact.set('ia_lead_stage', 'off')
        contact.set('ia_lead_pending_reply', false)
        contact.set('ia_lead_disabled_by', 'humano_followup')
        $app.saveNoValidate(contact)
        return
      }

      // Lead engajou (respondeu depois da última resposta da IA)? Aguarda humano/IA.
      if (lastInboundTs > 0 && lastInboundTs > lastAiReplyTs) return

      var lastClinicTs = Math.max(lastInboundTs, lastAiReplyTs)
      if (lastClinicTs === 0) return
      if (nowTs - lastClinicTs < 3 * 3600) return // ainda não deu 3h

      var result = callFabianaAi(contact, null, 'followup', 'ia_lead_loop: followup AI failed')
      if (!result) return // tenta no próximo tick

      var replyText = result && result.content ? result.content.trim() : ''
      if (!replyText) return

      var sentId = sendIaMessage(contact, replyText)
      if (!sentId) return

      contact.set('ia_lead_followup_count', (contact.getInt('ia_lead_followup_count') || 0) + 1)
      contact.set('ia_lead_last_followup_at', new Date().toISOString())
      $app.saveNoValidate(contact)
    }

    // Responde a resposta do lead DURANTE a triagem: extrai os dados, grava nos
    // campos da migration e pergunta a próxima pergunta pendente (1 por vez).
    var processTriagemReply = function (contact, nowTs) {
      var remoteJid = contact.getString('jid')
      var instanceName = contact.getString('instance_name')
      var t = parseTriagem(contact)
      if (t.pronto) return // triagem completa — nada a perguntar; equipe assume

      var lastInbound = null
      var lastInboundTs = 0
      try {
        var recents = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = false',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName },
        )
        if (recents && recents.length > 0) {
          lastInbound = recents[0]
          lastInboundTs = recents[0].getInt('timestamp') || 0
        }
      } catch (_) {}
      if (!lastInbound) return

      // Já houve mensagem da clínica depois da msg do lead? Nada a fazer.
      var lastMineTs = 0
      try {
        var mine = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst} && from_me = true',
          '-timestamp',
          1,
          0,
          { jid: remoteJid, inst: instanceName },
        )
        if (mine && mine.length > 0) lastMineTs = mine[0].getInt('timestamp') || 0
      } catch (_) {}
      if (lastMineTs >= lastInboundTs) return

      // Fail-safe: 3 falhas seguidas da IA → pausa até o lead mandar msg nova
      if ((t.fail_count || 0) >= 3 && (t.last_attempt_ts || 0) >= lastInboundTs) return

      // Delay natural de ~2 min antes de responder
      if (nowTs - lastInboundTs < 110) return

      var content = lastInbound.getString('content') || ''
      var transcription = lastInbound.getString('transcription') || ''
      if (
        (!content || content.indexOf('[audio') === 0 || content.indexOf('[Áudio') === 0) &&
        transcription &&
        transcription !== 'SKIP_NO_TRANSCRIBE'
      ) {
        content = '[Áudio transcrito]: ' + transcription
      }

      // Extração + avanço de etapa ANTES do prompt (a próxima pergunta já
      // considera o que acabou de ser respondido).
      extractTriagem(content, t)

      var result = callFabianaAi(contact, lastInbound, 'triagem', 'ia_lead_loop: triagem AI failed')
      var ok = false
      var replyText = result && result.content ? String(result.content).trim() : ''
      if (replyText) {
        var sentId = sendIaMessage(contact, replyText)
        if (sentId) ok = true
      }

      if (!ok) {
        // Degradação graciosa: registra a falha e tenta no próximo tick (máx. 3).
        t.fail_count = (t.fail_count || 0) + 1
        t.last_attempt_ts = nowTs
        saveTriagem(contact, t)
        $app.saveNoValidate(contact)
        return
      }

      t.fail_count = 0
      t.last_attempt_ts = 0
      saveTriagem(contact, t)
      $app.saveNoValidate(contact)
      $app
        .logger()
        .info(
          'ia_lead_loop: triagem processada',
          'jid',
          remoteJid,
          'etapa',
          t.etapa,
          'pronto',
          String(t.pronto),
        )
    }

    // ---------- fluxo principal ----------
    var processContacts = function (filter, handler) {
      var contacts = []
      try {
        contacts = $app.findRecordsByFilter('crm_contacts', filter, '-updated', 20, 0)
      } catch (_) {
        return
      }
      if (!contacts || contacts.length === 0) return
      var nowTs = Math.floor(Date.now() / 1000)
      for (var i = 0; i < contacts.length; i++) {
        var contact = contacts[i]
        try {
          var stage = contact.getString('ia_lead_stage') || ''
          if (stage === 'off' || stage === 'converted') continue
          if (isGlobalAutomationsPaused(contact.getString('account_id'))) continue

          // Fabiana humana de plantão (07h–17h): IA NÃO assume lead novo.
          var isHumanShift = isFabianaHumanShift()
          if (isHumanShift && stage === 'human_pending') continue

          handler(contact, nowTs)
        } catch (err) {
          $app.logger().error('ia_lead_loop_cron: contact error', 'err', String(err))
        }
      }
    }

    if (isNightShieldActive()) return // 21h–07h: nada é enviado

    if (isNoFollowupWindow()) {
      // 00h–04h: SEM follow-up. Só acolhimento (resposta ~2min) é permitido.
      processContacts('ia_lead_pending_reply = true', function (contact, nowTs) {
        processPendingReply(contact, nowTs)
      })
      return
    }

    processContacts('ia_lead_loop = true', function (contact, nowTs) {
      if (contact.getBool('ia_lead_pending_reply')) {
        processPendingReply(contact, nowTs)
        return
      }
      // Lead no MEIO da triagem respondeu? Retoma pela próxima pergunta.
      var t = parseTriagem(contact)
      if (!t.pronto) processTriagemReply(contact, nowTs)
      processFollowup(contact, nowTs)
    })
  } catch (fatalErr) {
    $app.logger().error('ia_lead_loop_cron fatal', 'err', String(fatalErr))
  }
})
