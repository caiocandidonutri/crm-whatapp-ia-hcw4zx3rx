cronAdd('auto_import_conversations', '*/30 * * * *', () => {
  let instances = []
  try {
    instances = $app.findRecordsByFilter(
      'whatsapp_instances',
      "status = 'connected' && is_importing_history = false",
      '-created',
      50,
      0,
    )
  } catch (err) {
    $app.logger().error('cron_auto_import_query_error', 'error', String(err))
    return
  }
  if (!instances || instances.length === 0) return

  var systemPrompt =
    'Voce e um classificador de CRM para conversas de WhatsApp do Dr. Caio (nutricionista).\n' +
    'Analise a conversa abaixo e classifique o contato.\n\n' +
    'Contexto: O Dr. Caio e um nutricionista que atende pacientes. As conversas podem ser sobre:\n' +
    '- Agendamento de consultas\n- Duvidas sobre cuidados nutricionais\n' +
    '- Retornos de pacientes existentes\n- Pessoas interessadas em conhecer o trabalho do Dr. Caio\n\n' +
    'Retorne APENAS um objeto JSON valido (sem texto adicional) com:\n' +
    '- "stage": uma de "lead", "em_atendimento", "cliente", "nao_respondido"\n' +
    '  - "lead": contato inicial, sem conversa significativa ainda\n' +
    '  - "em_atendimento": conversa ativa, em negociacao de consulta\n' +
    '  - "cliente": consulta confirmada ou agendada\n' +
    '  - "nao_respondido": contato parou de responder\n' +
    '- "role": "paciente" ou "nao_paciente"\n' +
    '- "is_patient": true se ja e paciente que fechou consulta\n' +
    '- "conversion_detected": true se detectou agendamento/confirmacao de consulta\n\n' +
    'Exemplo: {"stage":"em_atendimento","role":"paciente","is_patient":false,"conversion_detected":false}'

  var sPrompt =
    'You are an AI assistant for Dr. Caio, a nutritionist. Based on the conversation and contact info below, suggest the next best action and a priority score (1-10, where 10 is most urgent).\n\n' +
    'Return ONLY a JSON object: {"action": "short action in Portuguese", "priority": number}\n\n' +
    'Examples:\n{"action":"Seguir contato","priority":5}\n{"action":"Confirmar consulta","priority":8}'

  for (const instRec of instances) {
    var instanceId = instRec.id
    var authId = instRec.getString('user_id')
    var instanceName = instRec.getString('instance_name')
    var accountId = instRec.getString('account_id')

    try {
      var conversations = []
      try {
        conversations = $app.findRecordsByFilter(
          'conversations',
          'user_id = {:userId} && instance_name = {:inst} && is_group = false',
          '-updated',
          70,
          0,
          { userId: authId, inst: instanceName },
        )
      } catch (_) {
        continue
      }
      if (conversations.length === 0) continue

      instRec.set('is_importing_history', true)
      instRec.set('import_started_at', new Date().toISOString().replace('T', ' '))
      instRec.set('import_finished_at', '')
      instRec.set('import_total_count', conversations.length)
      instRec.set('import_messages_count', 0)
      $app.saveNoValidate(instRec)

      var created = 0,
        classified = 0,
        skipped = 0,
        errors = 0

      for (var i = 0; i < conversations.length; i++) {
        var conv = conversations[i]
        var remoteJid = conv.getString('remote_jid')
        var contactName = conv.getString('contact_name') || ''
        var avatarUrl = conv.getString('avatar_url') || ''
        var phone = conv.getString('contact_phone') || remoteJid.split('@')[0]

        var contact = null
        try {
          contact = $app.findFirstRecordByFilter(
            'crm_contacts',
            'instance_name = {:instance} && jid = {:jid}',
            { instance: instanceName, jid: remoteJid },
          )
        } catch (_) {}

        if (contact) {
          var exStage = contact.getString('stage')
          var exAction = contact.getString('ai_suggested_action')
          if (exStage && exStage !== 'lead' && exStage !== '' && exAction) {
            skipped++
            continue
          }
        }

        if (!contact) {
          try {
            var contactCol = $app.findCollectionByNameOrId('crm_contacts')
            contact = new Record(contactCol)
            contact.set('user_id', authId)
            if (accountId) contact.set('account_id', accountId)
            contact.set('instance_name', instanceName)
            contact.set('jid', remoteJid)
            contact.set('phone', phone)
            contact.set('push_name', contactName)
            contact.set('contact_name', contactName || '')
            contact.set('avatar_url', avatarUrl)
            contact.set('stage', 'lead')
            contact.set('role', '')
            $app.save(contact)
            created++
          } catch (err) {
            errors++
            continue
          }
        }

        var messages = []
        try {
          messages = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid} && instance_name = {:instance}',
            '-timestamp',
            10,
            0,
            { jid: remoteJid, instance: instanceName },
          )
        } catch (_) {
          skipped++
          continue
        }
        if (messages.length === 0) {
          skipped++
          continue
        }

        var sorted = messages.slice().reverse()
        var transcript = ''
        for (var j = 0; j < sorted.length; j++) {
          var m = sorted[j]
          var fromMe = m.getBool('from_me')
          var content = m.getString('content')
          if (!content || !content.trim()) {
            var trans = m.getString('transcription')
            if (trans && trans.trim()) {
              content = '[áudio transcrito: ' + trans.trim() + ']'
            } else {
              var mType = m.getString('message_type') || ''
              if (mType === 'audioMessage' || mType === 'audio' || mType === 'ptt') {
                content = '[áudio de voz]'
              } else {
                content = '[mídia]'
              }
            }
          }
          var sender = fromMe ? 'Atendente' : m.getString('push_name') || 'Contato'
          transcript += sender + ': ' + content + '\n'
        }

        var contentText = ''
        try {
          var classifyReply = $ai.chat({
            model: 'fast',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
          })
          contentText = classifyReply.choices[0].message.content
        } catch (aiErr) {
          errors++
          continue
        }

        var classification = null
        try {
          classification = JSON.parse(contentText)
        } catch (_) {
          var match = contentText.match(/\{[\s\S]*\}/)
          if (match) {
            try {
              classification = JSON.parse(match[0])
            } catch (_) {}
          }
        }
        if (!classification) {
          errors++
          continue
        }

        var validStages = ['lead', 'em_atendimento', 'cliente', 'nao_respondido']
        var newStage = validStages.indexOf(classification.stage) >= 0 ? classification.stage : null
        var newRole =
          classification.role === 'paciente' || classification.role === 'nao_paciente'
            ? classification.role
            : null
        var newIsPatient = classification.is_patient === true
        var newConversion = classification.conversion_detected === true

        if (newStage || newRole || newIsPatient || newConversion) {
          try {
            var contactRecord = $app.findRecordById('crm_contacts', contact.id)
            if (newStage) contactRecord.set('stage', newStage)
            if (newRole) contactRecord.set('role', newRole)
            if (newIsPatient || newConversion) {
              if (!contactRecord.getBool('is_patient')) contactRecord.set('is_patient', true)
              if (!contactRecord.getString('converted_at'))
                contactRecord.set('converted_at', new Date().toISOString().split('T')[0])
              if (newConversion) contactRecord.set('stage', 'cliente')
            }
            contactRecord.set('last_synced_at', new Date().toISOString().replace('T', ' '))
            $app.save(contactRecord)
            classified++
          } catch (err) {
            errors++
          }
        } else {
          skipped++
        }

        try {
          var sInput =
            'Stage: ' +
            (newStage || '') +
            '\nRole: ' +
            (newRole || '') +
            '\n\nTranscript:\n' +
            transcript
          var sRes = $ai.chat({
            model: 'fast',
            messages: [
              { role: 'system', content: sPrompt },
              { role: 'user', content: sInput },
            ],
            temperature: 0,
          })
          var sText = ''
          try {
            sText = sRes.choices[0].message.content
          } catch (_) {}
          var sObj = null
          try {
            sObj = JSON.parse(sText)
          } catch (_) {
            var sMatch = sText.match(/\{[\s\S]*\}/)
            if (sMatch) {
              try {
                sObj = JSON.parse(sMatch[0])
              } catch (_) {}
            }
          }
          if (sObj) {
            var sRecord = $app.findRecordById('crm_contacts', contact.id)
            sRecord.set('ai_suggested_action', sObj.action || '')
            sRecord.set('ai_priority', Math.min(Math.max(parseInt(sObj.priority) || 5, 1), 10))
            $app.save(sRecord)
          }
        } catch (sErr) {}

        if (i % 3 === 0 || i === conversations.length - 1) {
          try {
            var progInst = $app.findRecordById('whatsapp_instances', instanceId)
            progInst.set('import_messages_count', i + 1)
            $app.saveNoValidate(progInst)
          } catch (_) {}
        }
      }

      try {
        var finInst = $app.findRecordById('whatsapp_instances', instanceId)
        finInst.set('is_importing_history', false)
        finInst.set('import_finished_at', new Date().toISOString().replace('T', ' '))
        finInst.set('import_total_count', 0)
        $app.saveNoValidate(finInst)
      } catch (_) {}

      $app
        .logger()
        .info(
          'cron_auto_import_done',
          'instance',
          instanceName,
          'created',
          created,
          'classified',
          classified,
          'skipped',
          skipped,
          'errors',
          errors,
        )
    } catch (err) {
      $app.logger().error('cron_auto_import_error', 'instance', instanceName, 'error', String(err))
      try {
        var errInst = $app.findRecordById('whatsapp_instances', instanceId)
        errInst.set('is_importing_history', false)
        errInst.set('import_finished_at', new Date().toISOString().replace('T', ' '))
        errInst.set('import_total_count', 0)
        $app.saveNoValidate(errInst)
      } catch (_) {}
    }
  }
})
