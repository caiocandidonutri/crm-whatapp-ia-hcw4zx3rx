routerAdd(
  'POST',
  '/backend/v1/whatsapp/crm-classify/{conversationId}',
  (e) => {
    try {
      const conversationId = e.request.pathValue('conversationId')
      if (!conversationId) return e.badRequestError('conversationId is required')

      const userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      let conversation
      try {
        conversation = $app.findRecordById('conversations', conversationId)
      } catch (err) {
        return e.notFoundError('conversation not found')
      }

      const instanceName = conversation.getString('instance_name')
      const remoteJid = conversation.getString('remote_jid')
      const contactName = conversation.getString('contact_name') || remoteJid
      const accountId = conversation.getString('account_id')

      let existingContact = null
      try {
        existingContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'jid = {:jid} && instance_name = {:inst}',
          { jid: remoteJid, inst: instanceName },
        )
      } catch (_) {}

      // COOLDOWN DE 6 HORAS: verificar campo last_ai_reclassified_at
      if (existingContact) {
        const lastReclassifiedStr = existingContact.getString('last_ai_reclassified_at')
        if (lastReclassifiedStr) {
          const lastReclassifiedTime = new Date(lastReclassifiedStr).getTime()
          const sixHoursMs = 6 * 3600 * 1000
          if (!isNaN(lastReclassifiedTime) && Date.now() - lastReclassifiedTime < sixHoursMs) {
            const waitMins = Math.round((sixHoursMs - (Date.now() - lastReclassifiedTime)) / 60000)
            console.log(
              '[crm-classify] Cooldown ativo (6h) para contato ' +
                remoteJid +
                '. Restam ' +
                waitMins +
                ' min.',
            )
            return e.json(200, {
              classified: false,
              reason: 'cooldown_active',
              cooldown_remaining_minutes: waitMins,
              contact_id: existingContact.id,
            })
          }
        }
      }

      // TETO DIÁRIO DE ANÁLISES IA
      const dNow = new Date()
      const utcNow = dNow.getTime() + dNow.getTimezoneOffset() * 60000
      const spTime = new Date(utcNow - 3 * 3600000)
      const dayKey =
        spTime.getFullYear() +
        '-' +
        String(spTime.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(spTime.getDate()).padStart(2, '0')
      const usageFilter = accountId
        ? "day_key = '" + dayKey + "' && account_id = '" + accountId + "'"
        : "day_key = '" + dayKey + "'"
      let uRec = null
      try {
        uRec = $app.findFirstRecordByFilter('app_daily_usage', usageFilter)
      } catch (_) {}
      if (uRec) {
        const aCount = uRec.getInt('ai_analyses_count') || 0
        const aLimit = uRec.getInt('ai_analyses_limit') || 200
        const aPaused = uRec.getBool('ai_analyses_paused')
        if (aPaused || aCount >= aLimit) {
          return e.json(200, {
            classified: false,
            reason: 'daily_limit_reached',
            message: 'Teto diário de análises IA atingido hoje.',
          })
        }
      }

      let messages = []
      try {
        messages = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid} && instance_name = {:inst}',
          '-timestamp',
          8,
          0,
          { jid: remoteJid, inst: instanceName },
        )
      } catch (err) {
        $app.logger().error('crm-classify: failed to load messages', 'error', String(err))
      }

      if (messages.length === 0) {
        return e.json(200, { classified: false, reason: 'no_messages' })
      }

      function formatMessageContent(m) {
        const content = m.getString('content')
        if (content && content.trim()) {
          return content.trim().length > 300
            ? content.trim().substring(0, 300) + '…'
            : content.trim()
        }
        const transcription = m.getString('transcription')
        if (transcription && transcription.trim() && transcription !== 'SKIP_NO_TRANSCRIBE') {
          const cut = transcription.trim()
          return (
            '[áudio transcrito: ' + (cut.length > 200 ? cut.substring(0, 200) + '…' : cut) + ']'
          )
        }
        const msgType = m.getString('message_type') || ''
        if (msgType === 'audioMessage' || msgType === 'audio' || msgType === 'ptt') {
          return '[áudio de voz]'
        }
        return '[mídia]'
      }

      const transcript = messages
        .slice(0, 8)
        .reverse()
        .map(function (m) {
          const from = m.getBoolean('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
          return from + ': ' + formatMessageContent(m)
        })
        .join('\n')

      let rulesDesc = 'Consulta inicial (7d), Retorno de SOP (15d), Procedimento hormonal (5d)'
      try {
        const rules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 50, 0)
        const lines = []
        for (let r = 0; r < rules.length; r++) {
          const nm = rules[r].getString('name')
          const ds = rules[r].getInt('followup_days') || 10
          if (nm) lines.push(nm + ' (' + ds + 'd)')
        }
        if (lines.length > 0) rulesDesc = lines.join(', ')
      } catch (_) {}

      const pStage = (existingContact && existingContact.getString('stage')) || 'lead'
      const pCare = (existingContact && existingContact.getString('care_status')) || 'em_dia'
      let activeTasksCount = 0
      if (existingContact) {
        try {
          const tks = $app.findRecordsByFilter(
            'tasks',
            "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
            '-created',
            5,
            0,
            { cid: existingContact.id },
          )
          activeTasksCount = tks ? tks.length : 0
        } catch (_) {}
      }

      let aiResult = null
      try {
        const sysPrompt =
          'Você é o assistente de CRM e inteligência clínica da clínica de nutrição do Dr. Caio Cândido.\n' +
          'Papéis fundamentais da clínica:\n' +
          '- "Dr. Caio" / "Dr. Caio Cândido" é o nutricionista responsável pelas consultas e condutas.\n' +
          '- "Fabiana" é a assistente/secretária de atendimento e agendamento.\n' +
          '- Dr. Caio e Fabiana NUNCA devem ser interpretados como pacientes. O paciente é o interlocutor externo.\n' +
          'Regras de Follow-up lidas da clínica: ' +
          rulesDesc +
          '.\n' +
          'Vocabulário nutricional/clínico relevante: SOP (Síndrome dos Ovários Policísticos), plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica, sintomas e exames.\n\n' +
          'Responda APENAS em JSON válido com os campos:\n' +
          'stage (um de: lead, em_atendimento, cliente, nao_respondido),\n' +
          'priority (um de: baixa, media, alta, urgente ou número de 1 a 10),\n' +
          'suggested_action (breve próxima ação recomendada, max 120 chars).'

        const userPrompt =
          'Paciente/Contato: ' +
          contactName +
          '\n' +
          'Estágio do pipeline (stage): ' +
          pStage +
          '\n' +
          'Status de cuidado (care_status): ' +
          pCare +
          '\n' +
          'Tarefas ativas de cuidado: ' +
          activeTasksCount +
          '\n\n' +
          'Histórico da Conversa:\n' +
          transcript

        const reply = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'system',
              content: sysPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        })

        const rawText =
          reply.choices &&
          reply.choices[0] &&
          reply.choices[0].message &&
          reply.choices[0].message.content
        if (rawText) {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0])
          }
        }

        // Incrementar contador diário
        try {
          if (!uRec) {
            const uCol = $app.findCollectionByNameOrId('app_daily_usage')
            uRec = new Record(uCol)
            uRec.set('day_key', dayKey)
            if (accountId) uRec.set('account_id', accountId)
            uRec.set('transcriptions_count', 0)
            uRec.set('transcriptions_limit', 150)
            uRec.set('ai_analyses_count', 0)
            uRec.set('ai_analyses_limit', 200)
          }
          const nextCount = (uRec.getInt('ai_analyses_count') || 0) + 1
          uRec.set('ai_analyses_count', nextCount)
          if (nextCount >= (uRec.getInt('ai_analyses_limit') || 200)) {
            uRec.set('ai_analyses_paused', true)
          }
          $app.save(uRec)
        } catch (_) {}
      } catch (aiErr) {
        if (aiErr instanceof SkipAiConfigError) {
          return e.json(503, { error: 'AI temporarily unavailable' })
        }
        $app.logger().error('crm-classify: AI call failed', 'error', String(aiErr))
        return e.json(200, { classified: false, reason: 'ai_error' })
      }

      if (!aiResult) {
        return e.json(200, { classified: false, reason: 'parse_failed' })
      }

      let crmContact = null
      try {
        crmContact = $app.findFirstRecordByFilter(
          'crm_contacts',
          'jid = {:jid} && instance_name = {:inst}',
          { jid: remoteJid, inst: instanceName },
        )
      } catch (err) {
        // no existing contact
      }

      const nowIso = new Date().toISOString().replace('T', ' ')
      if (crmContact) {
        if (aiResult.stage) crmContact.set('stage', aiResult.stage)
        if (aiResult.suggested_action)
          crmContact.set('ai_suggested_action', aiResult.suggested_action)
        if (aiResult.priority) crmContact.set('ai_priority', aiResult.priority)
        crmContact.set('last_ai_reclassified_at', nowIso)
        $app.saveNoValidate(crmContact)
      } else {
        try {
          const col = $app.findCollectionByNameOrId('crm_contacts')
          crmContact = new Record(col)
          crmContact.set('user_id', userId)
          crmContact.set('instance_name', instanceName)
          crmContact.set('jid', remoteJid)
          crmContact.set('phone', conversation.getString('contact_phone') || '')
          crmContact.set('push_name', contactName)
          crmContact.set('contact_name', contactName)
          if (aiResult.stage) crmContact.set('stage', aiResult.stage)
          if (aiResult.suggested_action)
            crmContact.set('ai_suggested_action', aiResult.suggested_action)
          if (aiResult.priority) crmContact.set('ai_priority', aiResult.priority)
          crmContact.set('account_id', conversation.getString('account_id'))
          crmContact.set('last_ai_reclassified_at', nowIso)
          $app.saveNoValidate(crmContact)
        } catch (createErr) {
          $app.logger().error('crm-classify: failed to create contact', 'error', String(createErr))
        }
      }

      return e.json(200, {
        classified: true,
        conversation_id: conversationId,
        contact_id: crmContact ? crmContact.id : null,
        classification: aiResult,
      })
    } catch (err) {
      $app.logger().error('crm-classify: unexpected error', 'error', String(err))
      return e.json(500, { error: 'classification failed' })
    }
  },
  $apis.requireAuth(),
)
