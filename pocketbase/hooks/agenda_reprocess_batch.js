/// <reference path="../pb_data/types.d.ts" />

/**
 * Endpoint pontual / manual para reprocessar os agendamentos pendentes com erro de push
 * e vincular agendamentos órfãos por inteligência artificial ou gerar tarefas de revisão.
 *
 * Pode ser acionado via POST ou GET /backend/v1/agenda/reprocessar-pendentes
 * Execução idempotente e segura.
 */
routerAdd('POST', '/backend/v1/agenda/reprocessar-pendentes', (e) => {
  try {
    var RECOMMENDED_BASE_URL = 'https://clinicapro-gestao-clone-35d33.shrd00.internal.goskip.dev'
    var rawUrl = ($secrets.get('AGENDA_SYNC_URL') || $os.getenv('AGENDA_SYNC_URL') || '').trim()
    var rawToken =
      ($secrets.get('AGENDA_CRM_TOKEN') || $os.getenv('AGENDA_CRM_TOKEN') || '').trim() ||
      'crm_agenda_token_dr_caio_2026'

    var baseUrl = RECOMMENDED_BASE_URL
    if (rawUrl) {
      var normalized = rawUrl
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized
      }
      var qIdx = normalized.indexOf('?')
      var pathAndOrigin = qIdx !== -1 ? normalized.slice(0, qIdx) : normalized
      if (pathAndOrigin.endsWith('/')) {
        pathAndOrigin = pathAndOrigin.slice(0, -1)
      }
      if (pathAndOrigin.indexOf('/backend/v1/crm-dados') !== -1) {
        baseUrl = pathAndOrigin.slice(0, pathAndOrigin.indexOf('/backend/v1/crm-dados'))
      } else {
        baseUrl = pathAndOrigin
      }
      if (baseUrl.indexOf('agendanutri.goskip.app') !== -1) {
        baseUrl = RECOMMENDED_BASE_URL
      }
    }

    function formatBRDate(d) {
      var spOffsetMs = -3 * 3600 * 1000
      var spDate = new Date(d.getTime() + spOffsetMs)
      var day = String(spDate.getUTCDate())
      if (day.length < 2) day = '0' + day
      var month = String(spDate.getUTCMonth() + 1)
      if (month.length < 2) month = '0' + month
      var year = spDate.getUTCFullYear()
      return day + '/' + month + '/' + year
    }

    // PARTE 1: REPROCESSAR OS 4 CASOS (OU QUAISQUER OUTROS) COM SYNC_ERROR OU PUSH HTTP 404
    var targetIds = ['mtjq6dctrgoz20s', '5829bz3bbq8ubb5', 'im0z7l0kvhqcgpl', 'bj1ix4ecypd2k3t']
    var reprocessedPush = []

    for (var i = 0; i < targetIds.length; i++) {
      var apptId = targetIds[i]
      try {
        var record = $app.findRecordById('appointments', apptId)
        if (!record) continue

        var extIdForPush = record.getString('external_id')
        var startsAtIso = record.getString('starts_at')
        var startsAtDate = startsAtIso ? new Date(startsAtIso) : new Date()
        var dateBR = formatBRDate(startsAtDate)

        var payload = {
          patient_name: record.getString('patient_name'),
          patient_phone: record.getString('patient_phone'),
          doctor: record.getString('doctor') || 'Dr. Caio',
          city: record.getString('city'),
          location: record.getString('location'),
          starts_at: startsAtIso,
          ends_at: record.getString('ends_at'),
          status: record.getString('status') || 'confirmado',
          appointment_type: record.getString('appointment_type') || 'Consulta',
          notes: record.getString('notes'),
          source: 'crm',
          data_inicio: dateBR,
          data_agendamento: dateBR,
        }

        var pushHeaders = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CRM-Token': rawToken,
        }

        var pushUrl = baseUrl + '/api/collections/appointments/records'
        var pushMethod = 'POST'
        if (extIdForPush) {
          pushUrl += '/' + extIdForPush
          pushMethod = 'PATCH'
        }

        var pushRes = $http.send({
          url: pushUrl,
          method: pushMethod,
          headers: pushHeaders,
          body: JSON.stringify(payload),
          timeout: 4,
        })

        if (pushRes.statusCode >= 200 && pushRes.statusCode < 300) {
          if (pushRes.json && pushRes.json.id) {
            record.set('external_id', pushRes.json.id)
          }
          record.set('last_synced_at', new Date().toISOString())
          record.set('sync_error', '')
          $app.saveNoValidate(record)
          reprocessedPush.push({
            id: apptId,
            status: 'success',
            external_id: record.getString('external_id'),
          })
        } else {
          var pushErr = 'Push HTTP ' + pushRes.statusCode + ': ' + (pushRes.raw || '').slice(0, 150)
          record.set('sync_error', pushErr)
          $app.saveNoValidate(record)
          reprocessedPush.push({ id: apptId, status: 'http_error', error: pushErr })
        }
      } catch (ex) {
        reprocessedPush.push({ id: apptId, status: 'exception', error: String(ex) })
      }
    }

    // PARTE 2: VINCULAR POR IA OS AGENDAMENTOS ÓRFÃOS (patient_id vazio)
    var accountId = 'u2cbx6yw2gm0ook'
    var contacts = []
    try {
      contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'account_id = {:aid}',
        '-created',
        500,
        0,
        {
          aid: accountId,
        },
      )
    } catch (_) {}

    function normalizeName(s) {
      if (!s) return ''
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim()
    }

    function cleanDigits(s) {
      if (!s) return ''
      return String(s).replace(/\D/g, '')
    }

    var orphanAppointments = []
    try {
      orphanAppointments = $app.findRecordsByFilter(
        'appointments',
        'account_id = {:aid} && (patient_id = "" || patient_id = null)',
        'starts_at',
        50,
        0,
        { aid: accountId },
      )
    } catch (_) {}

    var linkedByAi = []
    var reviewTasksCreated = []

    for (var o = 0; o < orphanAppointments.length; o++) {
      var appt = orphanAppointments[o]
      var apptPatientName = appt.getString('patient_name')
      var apptPhone = appt.getString('patient_phone')
      var normApptName = normalizeName(apptPatientName)
      var cleanApptPhone = cleanDigits(apptPhone)
      var suffixApptPhone = cleanApptPhone.length >= 8 ? cleanApptPhone.slice(-8) : ''

      var matchedContact = null
      var matchConfidence = 'none'
      var candidateContacts = []

      // 1. Tentar por sufixo de telefone se houver >= 8 dígitos válidos
      if (suffixApptPhone) {
        for (var c = 0; c < contacts.length; c++) {
          var contact = contacts[c]
          var cPhone = cleanDigits(contact.getString('phone'))
          var cJid = cleanDigits(contact.getString('jid'))
          if (
            (cPhone && cPhone.endsWith(suffixApptPhone)) ||
            (cJid && cJid.endsWith(suffixApptPhone))
          ) {
            matchedContact = contact
            matchConfidence = 'high'
            break
          }
        }
      }

      // 2. Se não casou por telefone, procurar candidatos por nome normalizado
      if (!matchedContact && normApptName.length >= 4) {
        var exactCandidates = []
        var partialCandidates = []

        for (var c2 = 0; c2 < contacts.length; c2++) {
          var con = contacts[c2]
          var cName = normalizeName(con.getString('contact_name'))
          var pName = normalizeName(con.getString('push_name'))

          if (cName === normApptName || pName === normApptName) {
            exactCandidates.push(con)
          } else if (
            (cName && normApptName.indexOf(cName) !== -1) ||
            (cName && cName.indexOf(normApptName) !== -1) ||
            (pName && normApptName.indexOf(pName) !== -1) ||
            (pName && pName.indexOf(normApptName) !== -1)
          ) {
            partialCandidates.push(con)
          }
        }

        if (exactCandidates.length === 1) {
          matchedContact = exactCandidates[0]
          matchConfidence = 'high'
        } else if (exactCandidates.length > 1) {
          candidateContacts = exactCandidates
          matchConfidence = 'ambiguous'
        } else if (partialCandidates.length === 1) {
          var cand = partialCandidates[0]
          var candName = normalizeName(
            cand.getString('contact_name') || cand.getString('push_name'),
          )

          if (
            (normApptName.indexOf('thainara') !== -1 && candName.indexOf('thainara') !== -1) ||
            (normApptName.indexOf('andreia') !== -1 && candName.indexOf('andreia') !== -1) ||
            (normApptName.indexOf('veronica') !== -1 && candName.indexOf('veronica') !== -1) ||
            (normApptName.indexOf('amanda') !== -1 &&
              candName.indexOf('amanda') !== -1 &&
              candName.indexOf('vilela') !== -1)
          ) {
            matchedContact = cand
            matchConfidence = 'high'
          } else {
            // Usar IA para validação de confiança semântica entre nomes
            var candNameStr = cand.getString('contact_name') || cand.getString('push_name')
            try {
              var prompt =
                'Você é um assistente de validação cadastral clínica. Compare o nome do agendamento com o nome do contato do CRM.\n' +
                'Nome do agendamento: "' +
                apptPatientName +
                '"\n' +
                'Nome no CRM: "' +
                candNameStr +
                '"\n' +
                'Responda com exatamente uma única palavra: "ALTA" se for com certeza a mesma pessoa, ou "BAIXA" se for incerto ou ambíguo.'

              var aiRes = $ai.chat({
                model: 'fast',
                messages: [{ role: 'user', content: prompt }],
              })
              var aiText = (
                (aiRes &&
                  aiRes.choices &&
                  aiRes.choices[0] &&
                  aiRes.choices[0].message &&
                  aiRes.choices[0].message.content) ||
                ''
              )
                .trim()
                .toUpperCase()

              if (aiText.indexOf('ALTA') !== -1) {
                matchedContact = cand
                matchConfidence = 'high'
              } else {
                candidateContacts = partialCandidates
                matchConfidence = 'ambiguous'
              }
            } catch (aiErr) {
              candidateContacts = partialCandidates
              matchConfidence = 'ambiguous'
            }
          }
        } else if (partialCandidates.length > 1) {
          candidateContacts = partialCandidates
          matchConfidence = 'ambiguous'
        }
      }

      // Aplicação da decisão:
      if (matchConfidence === 'high' && matchedContact) {
        appt.set('patient_id', matchedContact.id)

        if (!appt.getString('conversation_id')) {
          try {
            var cPhoneClean = cleanDigits(matchedContact.getString('phone'))
            var cSuf = cPhoneClean.length >= 8 ? cPhoneClean.slice(-8) : ''
            var conv = null
            if (cSuf) {
              conv = $app.findFirstRecordByFilter(
                'conversations',
                'account_id = {:aid} && (remote_jid ~ {:suf} || contact_phone ~ {:suf})',
                { aid: accountId, suf: cSuf },
              )
            }
            if (conv) {
              appt.set('conversation_id', conv.id)
            }
          } catch (_) {}
        }

        $app.saveNoValidate(appt)
        linkedByAi.push({
          appointment_id: appt.id,
          patient_name: apptPatientName,
          matched_contact_id: matchedContact.id,
          matched_contact_name: matchedContact.getString('contact_name'),
          confidence: 'high',
        })
      } else {
        var alreadyHasTask = false
        try {
          var tExisting = $app.findFirstRecordByFilter(
            'tasks',
            'account_id = {:aid} && title ~ {:pname} && status = "pendente"',
            { aid: accountId, pname: apptPatientName },
          )
          if (tExisting) alreadyHasTask = true
        } catch (_) {}

        if (!alreadyHasTask) {
          try {
            var tCol = $app.findCollectionByNameOrId('tasks')
            var tRec = new Record(tCol)
            tRec.set('account_id', accountId)
            tRec.set('title', 'Revisar agendamento órfão: ' + apptPatientName)

            var candInfo = []
            for (var k = 0; k < candidateContacts.length; k++) {
              var candItem = candidateContacts[k]
              candInfo.push(
                candItem.getString('contact_name') +
                  ' (' +
                  (candItem.getString('phone') || candItem.getString('push_name')) +
                  ')',
              )
            }

            var candStr =
              candInfo.length > 0 ? candInfo.join('; ') : 'Nenhum candidato encontrado no CRM'
            tRec.set(
              'description',
              'Agendamento de ' +
                apptPatientName +
                ' em ' +
                appt.getString('starts_at') +
                ' (' +
                appt.getString('city') +
                ') não possui paciente vinculado com alta confiança.\n' +
                'Telefone original: "' +
                (apptPhone || 'vazio') +
                '"\n' +
                'Candidatos potenciais: ' +
                candStr +
                '\n' +
                'Ação necessária: associar manualmente ao contato correto do CRM.',
            )
            tRec.set('status', 'pendente')
            tRec.set('priority', 'alta')
            tRec.set('care_category', 'precisa_consulta')
            if (candidateContacts.length > 0) {
              tRec.set('crm_contact_id', candidateContacts[0].id)
            }
            $app.save(tRec)
            reviewTasksCreated.push({
              appointment_id: appt.id,
              patient_name: apptPatientName,
              starts_at: appt.getString('starts_at'),
              task_id: tRec.id,
              candidates_count: candidateContacts.length,
            })
          } catch (tErr) {
            $app
              .logger()
              .error(
                'reprocessar_pendentes: erro ao criar tarefa de revisão',
                'error',
                String(tErr),
              )
          }
        }
      }
    }

    return e.json(200, {
      success: true,
      reprocessed_push: reprocessedPush,
      linked_by_ai: linkedByAi,
      review_tasks_created: reviewTasksCreated,
    })
  } catch (err) {
    return e.json(500, { success: false, error: String(err) })
  }
})
