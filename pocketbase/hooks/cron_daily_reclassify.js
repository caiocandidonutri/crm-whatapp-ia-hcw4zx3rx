cronAdd('daily_reclassify', '0 9 * * *', () => {
  var accounts = []
  try {
    accounts = $app.findRecordsByFilter('accounts', 'id != ""', 'created', 500, 0)
  } catch (_) {
    return
  }
  if (!accounts || accounts.length === 0) return

  var nowTs = Math.floor(Date.now() / 1000)
  var fortyEightHoursAgo = nowTs - 48 * 3600

  var rulesById = {}
  try {
    var allRules = $app.findRecordsByFilter('care_followup_rules', 'id != ""', 'created', 500, 0)
    for (var rl = 0; rl < allRules.length; rl++) {
      rulesById[allRules[rl].id] = allRules[rl].getInt('followup_days') || 10
    }
  } catch (_) {}

  var totalClassified = 0
  var totalProcessed = 0

  for (var a = 0; a < accounts.length; a++) {
    var accountId = accounts[a].id
    var contacts = []
    try {
      contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'account_id = {:accId}',
        '-updated',
        500,
        0,
        { accId: accountId },
      )
    } catch (_) {
      continue
    }
    if (!contacts || contacts.length === 0) continue

    var aiClassified = 0

    for (var i = 0; i < contacts.length; i++) {
      var contact = contacts[i]
      var jid = contact.getString('jid') || ''
      var instanceName = contact.getString('instance_name') || ''

      if (aiClassified < 30 && jid && instanceName) {
        var messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:inst} && timestamp >= {:ts}',
            '-timestamp',
            15,
            0,
            { jid: jid, inst: instanceName, ts: fortyEightHoursAgo },
          )
        } catch (_) {}

        if (messages && messages.length > 0) {
          var transcript = messages
            .slice()
            .reverse()
            .map(function (m) {
              var from = m.getBool('from_me') ? 'Atendente' : m.getString('push_name') || 'Cliente'
              return from + ': ' + (m.getString('content') || '[mídia]')
            })
            .join('\n')

          var contactName =
            contact.getString('contact_name') || contact.getString('push_name') || jid

          try {
            var reply = $ai.chat({
              model: 'fast',
              messages: [
                {
                  role: 'system',
                  content:
                    'Você é um assistente de CRM. Analise a conversa do WhatsApp e classifique o contato. ' +
                    'Responda APENAS em JSON válido com os campos: ' +
                    'stage (um de: lead, em_atendimento, cliente, nao_respondido), ' +
                    'role (um de: paciente, nao_paciente), ' +
                    'is_patient (boolean: true se o contato é paciente/cliente que fechou consulta), ' +
                    'conversion_detected (boolean: true se detectou agendamento/confirmação/fechamento de consulta), ' +
                    'suggested_action (breve próxima ação recomendada, max 120 chars), ' +
                    'priority (número 1-10, onde 10 é urgente).',
                },
                {
                  role: 'user',
                  content: 'Contato: ' + contactName + '\n\nTranscrição:\n' + transcript,
                },
              ],
            })

            var rawText =
              reply.choices &&
              reply.choices[0] &&
              reply.choices[0].message &&
              reply.choices[0].message.content
            if (rawText) {
              var jsonMatch = rawText.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                var aiResult = JSON.parse(jsonMatch[0])
                var validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
                if (aiResult.stage && validStages.indexOf(aiResult.stage) >= 0) {
                  contact.set('stage', aiResult.stage)
                }
                if (aiResult.role === 'paciente' || aiResult.role === 'nao_paciente') {
                  contact.set('role', aiResult.role)
                }

                var conversionDetected = aiResult.conversion_detected === true
                var isPatient = aiResult.is_patient === true

                if (conversionDetected || isPatient) {
                  if (!contact.getBool('is_patient')) contact.set('is_patient', true)
                  if (!contact.getString('converted_at')) {
                    contact.set('converted_at', new Date().toISOString().split('T')[0])
                  }
                  if (conversionDetected) contact.set('stage', 'cliente')
                }

                if (aiResult.suggested_action) {
                  contact.set(
                    'ai_suggested_action',
                    String(aiResult.suggested_action).substring(0, 500),
                  )
                }
                if (aiResult.priority !== undefined) {
                  var pri = Number(aiResult.priority)
                  if (Number.isFinite(pri)) {
                    contact.set('ai_priority', Math.min(Math.max(pri, 1), 10))
                  }
                }
                aiClassified++
                totalClassified++
              }
            }
          } catch (_) {}
        }
      }

      var careStatus = 'em_dia'
      if (contact.getBool('is_patient')) {
        var convertedAt = contact.getString('converted_at')
        if (convertedAt) {
          var convTs = Math.floor(new Date(convertedAt).getTime() / 1000)
          var daysSince = Math.floor((nowTs - convTs) / 86400)
          var fRuleId = contact.getString('followup_rule_id') || ''
          var fDays = 10
          if (fRuleId && rulesById[fRuleId]) fDays = rulesById[fRuleId]
          if (daysSince >= fDays) careStatus = 'precisa_retorno'
        }
      }

      var lastSynced = contact.getString('last_synced_at')
      if (lastSynced) {
        var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
        if (!isNaN(lastTs) && nowTs - lastTs >= 30 * 86400) {
          careStatus = 'sem_contato_' + Math.floor((nowTs - lastTs) / 86400) + '_dias'
        }
      }

      contact.set('care_status', careStatus)
      contact.set('last_synced_at', new Date().toISOString().replace('T', ' '))
      try {
        $app.saveNoValidate(contact)
      } catch (_) {}
      totalProcessed++
    }
  }

  if (totalProcessed > 0) {
    $app
      .logger()
      .info('daily_reclassify_done', 'processed', totalProcessed, 'classified', totalClassified)
  }
})
