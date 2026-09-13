routerAdd(
  'POST',
  '/backend/v1/crm/refresh-suggestions',
  (e) => {
    try {
      const userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      let accountId = ''
      try {
        accountId = e.auth.get('account_id') || ''
      } catch (_) {}

      let contacts = []
      try {
        if (accountId) {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'account_id = {:accountId}',
            '-updated',
            200,
            0,
            { accountId: accountId },
          )
        } else {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'user_id = {:userId}',
            '-updated',
            200,
            0,
            { userId: userId },
          )
        }
      } catch (_) {
        return e.json(200, { total: 0, updated: 0, errors: 0 })
      }

      let updated = 0
      let errors = 0

      var rulesText = 'Consulta inicial 7d, Retorno de SOP 15d, Procedimento hormonal 5d'
      try {
        var rList = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 50, 0)
        var rParts = []
        for (var ri = 0; ri < rList.length; ri++) {
          var rName = rList[ri].getString('name')
          var rDays = rList[ri].getInt('followup_days') || 10
          if (rName) rParts.push(rName + ' (' + rDays + 'd)')
        }
        if (rParts.length > 0) rulesText = rParts.join(', ')
      } catch (_) {}

      var systemPrompt =
        'Você é o assistente de inteligência clínica e CRM da clínica de nutrição do Dr. Caio Cândido.\n' +
        'Papéis fixos: "Dr. Caio" é o nutricionista responsável; "Fabiana" é a assistente/secretária. NUNCA interpretá-los como pacientes.\n' +
        'Regras de Follow-up lidas do banco: ' +
        rulesText +
        '.\n' +
        'Vocabulário nutricional: SOP, plano alimentar, retorno, bioimpedância, tireoide, resistência insulínica.\n' +
        'Responda em JSON com: { "suggested_action": string (próxima ação recomendada, max 200 chars), "priority": number (1-5, onde 5 é urgente) }. Responda apenas o JSON.'

      // Teto diário de IA
      const dNow = new Date()
      const utcNow = dNow.getTime() + dNow.getTimezoneOffset() * 60000
      const spTime = new Date(utcNow - 3 * 3600000)
      const dayKey =
        spTime.getFullYear() +
        '-' +
        String(spTime.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(spTime.getDate()).padStart(2, '0')
      const uFilter = accountId
        ? "day_key = '" + dayKey + "' && account_id = '" + accountId + "'"
        : "day_key = '" + dayKey + "'"
      let uRec = null
      try {
        uRec = $app.findFirstRecordByFilter('app_daily_usage', uFilter)
      } catch (_) {}

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i]
        const contactId = contact.id

        // Cooldown 6h por contato
        const lastRecStr = contact.getString('last_ai_reclassified_at')
        if (lastRecStr) {
          const lastRecTime = new Date(lastRecStr).getTime()
          if (!isNaN(lastRecTime) && Date.now() - lastRecTime < 6 * 3600 * 1000) {
            continue
          }
        }

        // Teto diário de IA
        if (uRec) {
          const aCount = uRec.getInt('ai_analyses_count') || 0
          const aLimit = uRec.getInt('ai_analyses_limit') || 200
          if (uRec.getBool('ai_analyses_paused') || aCount >= aLimit) {
            break
          }
        }

        try {
          const contactName =
            contact.getString('contact_name') || contact.getString('push_name') || 'Contato'
          const phone = contact.getString('phone') || ''
          const stage = contact.getString('stage') || ''
          const careStatus = contact.getString('care_status') || 'em_dia'
          const notes = contact.getString('notes') || ''

          let activeTasksCount = 0
          try {
            const tks = $app.findRecordsByFilter(
              'tasks',
              "crm_contact_id = {:cid} && status != 'concluida' && status != 'cancelada'",
              '-created',
              5,
              0,
              { cid: contactId },
            )
            activeTasksCount = tks ? tks.length : 0
          } catch (_) {}

          var messages = []
          try {
            var conversations = $app.findRecordsByFilter(
              'conversations',
              'contact_phone = {:phone}',
              '-created',
              5,
              0,
              phone,
            )
            if (conversations.length > 0) {
              var conv = conversations[0]
              var recentMsgs = $app.findRecordsByFilter(
                'whatsapp_messages',
                'remote_jid = {:jid}',
                '-timestamp',
                10,
                0,
                conv.getString('remote_jid'),
              )
              for (var j = 0; j < recentMsgs.length; j++) {
                var m = recentMsgs[j]
                var content = m.getString('content')
                if (content) {
                  messages.push(
                    m.getBool('from_me') ? 'Atendente: ' + content : 'Cliente: ' + content,
                  )
                }
              }
            }
          } catch (_) {}

          var contextParts = [
            'Nome do Paciente/Contato: ' + contactName,
            phone ? 'Telefone: ' + phone : '',
            stage ? 'Estágio do pipeline (stage): ' + stage : '',
            'Status de cuidado (care_status): ' + careStatus,
            'Tarefas ativas de cuidado: ' + activeTasksCount,
            'Ao falar de agendamento, considere o local registrado no CRM; se não houver, pergunte educadamente a preferência entre Carmo do Rio Claro (Climed), Alfenas (Instituto Harmoniza) e Monte Belo.',
            notes ? 'Notas: ' + notes : '',
            messages.length > 0 ? 'Mensagens recentes:\n' + messages.join('\n') : '',
          ].filter(Boolean)

          var reply = $ai.chat({
            model: 'fast',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: contextParts.join('\n') },
            ],
          })

          var text = reply.choices[0].message.content.trim()
          var parsed
          try {
            var jsonMatch = text.match(/\{[\s\S]*\}/)
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text)
          } catch (_) {
            parsed = { suggested_action: text.substring(0, 200), priority: 3 }
          }

          var contactRecord = $app.findRecordById('crm_contacts', contactId)
          contactRecord.set(
            'ai_suggested_action',
            String(parsed.suggested_action || '').substring(0, 200),
          )
          var priority = Number(parsed.priority)
          contactRecord.set(
            'ai_priority',
            Number.isFinite(priority) ? Math.min(Math.max(priority, 1), 5) : 3,
          )
          const nowIso = new Date().toISOString().replace('T', ' ')
          contactRecord.set('last_ai_reclassified_at', nowIso)
          $app.save(contactRecord)

          // Incrementa teto diário
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
            const cur = (uRec.getInt('ai_analyses_count') || 0) + 1
            uRec.set('ai_analyses_count', cur)
            if (cur >= (uRec.getInt('ai_analyses_limit') || 200)) {
              uRec.set('ai_analyses_paused', true)
            }
            $app.save(uRec)
          } catch (_) {}

          updated++
        } catch (err) {
          errors++
        }
      }

      // === CARE ALERTS: needs_care for high-priority patients ===
      if (!accountId && userId) {
        try {
          var mbr = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
            uid: userId,
          })
          accountId = mbr.getString('account_id')
        } catch (_) {}
      }
      if (accountId) {
        try {
          var cSettings = null
          try {
            cSettings = $app.findFirstRecordByFilter('care_alert_settings', 'account_id = {:aid}', {
              aid: accountId,
            })
          } catch (_) {}
          if (
            cSettings &&
            cSettings.getBool('needs_care_alert_enabled') &&
            cSettings.getString('whatsapp_alert_phone')
          ) {
            var cPhone = cSettings.getString('whatsapp_alert_phone').replace(/\D/g, '')
            var cCutoff = new Date(Date.now() - 86400000).toISOString()
            var cUrl = $secrets.get('EVOLUTION_API_URL')
            var cKey = $secrets.get('EVOLUTION_API_KEY')
            var cAlerts = []
            try {
              cAlerts = $app.findRecordsByFilter(
                'crm_contacts',
                'account_id = {:aid} && is_patient = true && ai_priority >= 4',
                '-ai_priority',
                10,
                0,
                { aid: accountId },
              )
            } catch (_) {}
            for (var ci = 0; ci < cAlerts.length; ci++) {
              var cContact = cAlerts[ci]
              var cStatusVal = cContact.getString('care_status') || ''
              if (cStatusVal === '' || cStatusVal === 'em_dia') continue
              var cDup = false
              try {
                $app.findFirstRecordByFilter(
                  'care_alerts',
                  'crm_contact_id = {:cid} && type = {:t} && created >= {:c}',
                  { cid: cContact.id, t: 'needs_care', c: cCutoff },
                )
                cDup = true
              } catch (_) {}
              if (cDup) continue
              var cName =
                cContact.getString('contact_name') || cContact.getString('push_name') || 'Paciente'
              var cAction = cContact.getString('ai_suggested_action') || 'Entrar em contato'
              var cMsg =
                'Dr. Caio, a paciente ' +
                cName +
                ' precisa de atencao. 💛\n\nStatus: ' +
                cStatusVal +
                '\nSugestao: ' +
                cAction.substring(0, 200)
              var cInst = cContact.getString('instance_name')
              var cCol = $app.findCollectionByNameOrId('care_alerts')
              var cRec = new Record(cCol)
              cRec.set('account_id', accountId)
              cRec.set('type', 'needs_care')
              cRec.set('crm_contact_id', cContact.id)
              cRec.set('message', cMsg)
              cRec.set('status', 'pending')
              $app.save(cRec)
              var cSendStatus = 'failed'
              if (cUrl && cKey && cInst) {
                var cU = cUrl.endsWith('/') ? cUrl.slice(0, -1) : cUrl
                try {
                  var cRes = $http.send({
                    url: cU + '/message/sendText/' + cInst,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', apikey: cKey },
                    body: JSON.stringify({ number: cPhone, text: cMsg }),
                    timeout: 15,
                  })
                  cSendStatus =
                    cRes.statusCode === 200 || cRes.statusCode === 201 ? 'sent' : 'failed'
                } catch (_) {}
              }
              cRec.set('status', cSendStatus)
              cRec.set('sent_at', new Date().toISOString())
              $app.save(cRec)
            }
          }
        } catch (_) {}
      }

      return e.json(200, {
        total: contacts.length,
        updated: updated,
        errors: errors,
      })
    } catch (err) {
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'AI temporariamente indisponivel' })
      }
      if (err instanceof SkipAiError) {
        var status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'AI temporariamente indisponivel' : err.message,
        })
      }
      throw err
    }
  },
  $apis.requireAuth(),
)
