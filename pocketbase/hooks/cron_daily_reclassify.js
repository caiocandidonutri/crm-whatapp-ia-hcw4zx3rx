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

  // --- Limiares de follow-up por conta (care_followup_thresholds) ---
  // Permite configurar após quantos dias sem resposta um paciente entra
  // em cada categoria: "nao_respondeu", "precisa_atencao", "perdido".
  // Defaults: nao_respondeu=3, precisa_atencao=7, perdido=15.
  var DEFAULT_THRESHOLDS = {
    nao_respondeu: 3,
    precisa_atencao: 7,
    perdido: 15,
  }
  var thresholdsByAccount = {}
  try {
    var allThresholds = $app.findRecordsByFilter(
      'care_followup_thresholds',
      'id != ""',
      'created',
      500,
      0,
    )
    for (var th = 0; th < allThresholds.length; th++) {
      var tRec = allThresholds[th]
      var tAccId = tRec.getString('account_id')
      if (!thresholdsByAccount[tAccId]) {
        thresholdsByAccount[tAccId] = {
          nao_respondeu: DEFAULT_THRESHOLDS.nao_respondeu,
          precisa_atencao: DEFAULT_THRESHOLDS.precisa_atencao,
          perdido: DEFAULT_THRESHOLDS.perdido,
        }
      }
      var tCat = tRec.getString('category')
      if (tRec.getBool('enabled') && thresholdsByAccount[tAccId][tCat] !== undefined) {
        thresholdsByAccount[tAccId][tCat] = tRec.getInt('days') || DEFAULT_THRESHOLDS[tCat]
      }
    }
  } catch (_) {}

  var getThresholds = function (accId) {
    if (accId && thresholdsByAccount[accId]) return thresholdsByAccount[accId]
    return DEFAULT_THRESHOLDS
  }

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

      // Se o contato pertencer a instância desconectada, pula
      try {
        var instRec = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'instance_name = {:name}',
          { name: instanceName },
        )
        if (instRec && instRec.getString('status') !== 'connected') {
          continue
        }
      } catch (_) {}

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

      // Aplica os limiares de follow-up configurados (sem resposta por
      // N dias → "nao_respondeu"; por M dias → "precisa_atencao"; por
      // P dias → "perdido"). Baseia-se na última sincronização de
      // atividade do contato (last_synced_at), que reflete o último
      // contato registrado.
      var lastSynced = contact.getString('last_synced_at')
      if (lastSynced) {
        var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
        if (!isNaN(lastTs)) {
          var daysNoResponse = Math.floor((nowTs - lastTs) / 86400)
          var thresholds = getThresholds(accountId)
          if (daysNoResponse >= thresholds.perdido) {
            careStatus = 'perdido'
          } else if (daysNoResponse >= thresholds.precisa_atencao) {
            careStatus = 'precisa_atencao'
          } else if (daysNoResponse >= thresholds.nao_respondeu) {
            careStatus = 'nao_respondeu'
          } else if (daysNoResponse >= 30) {
            careStatus = 'sem_contato_' + daysNoResponse + '_dias'
          }
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
