routerAdd(
  'GET',
  '/backend/v1/crm-care/patient-groups',
  (e) => {
    try {
      var userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      var accountId = ''
      try {
        var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: userId,
        })
        accountId = member.getString('account_id')
      } catch (_) {}

      if (!accountId) {
        return e.json(200, {
          overview: { em_dia: 0, precisa_retorno: 0, desassistidos: 0 },
          groups: {
            precisa_retorno: [],
            nao_responderam: [],
            precisam_de_acao: [],
            precisam_de_consulta: [],
            followup_window: [],
            alta_demanda: [],
          },
        })
      }

      var query = e.requestInfo().query || {}
      var periodDays = parseInt(query.period_days || '0', 10) || 0
      var filterCareStatus = query.care_status || ''
      var filterStage = query.stage || ''
      var minPriority = parseInt(query.min_priority || '0', 10) || 0

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
      } catch (_) {}

      var nowTs = Math.floor(Date.now() / 1000)
      var twentyFourHoursAgo = nowTs - 86400

      if (periodDays > 0) {
        var periodCutoff = nowTs - periodDays * 86400
        contacts = contacts.filter(function (c) {
          var updatedStr = c.getString('updated')
          if (updatedStr) {
            var updatedTs = Math.floor(new Date(updatedStr).getTime() / 1000)
            return !isNaN(updatedTs) && updatedTs >= periodCutoff
          }
          return false
        })
      }

      if (filterCareStatus) {
        contacts = contacts.filter(function (c) {
          var cs = c.getString('care_status') || 'em_dia'
          if (filterCareStatus === 'desassistido') {
            var lastSynced = c.getString('last_synced_at')
            if (lastSynced) {
              var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
              return !isNaN(lastTs) && nowTs - lastTs >= 30 * 86400
            }
            var createdTs = Math.floor(new Date(c.getString('created')).getTime() / 1000)
            return !isNaN(createdTs) && nowTs - createdTs >= 30 * 86400
          }
          return cs === filterCareStatus
        })
      }

      if (filterStage) {
        contacts = contacts.filter(function (c) {
          return (c.getString('stage') || '') === filterStage
        })
      }

      if (minPriority > 0) {
        contacts = contacts.filter(function (c) {
          return (c.getInt('ai_priority') || 0) >= minPriority
        })
      }

      var overview = { em_dia: 0, precisa_retorno: 0, desassistidos: 0 }
      var groups = {
        precisa_retorno: [],
        nao_responderam: [],
        precisam_de_acao: [],
        precisam_de_consulta: [],
        followup_window: [],
        alta_demanda: [],
      }

      var altaDemandaJids = []
      try {
        var highVolumeMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'account_id = {:accId} && from_me = false && timestamp >= {:ts}',
          '-timestamp',
          1000,
          0,
          { accId: accountId, ts: twentyFourHoursAgo },
        )
        var msgCounts = {}
        for (var h = 0; h < highVolumeMsgs.length; h++) {
          var jid = highVolumeMsgs[h].getString('remote_jid')
          if (jid && jid.indexOf('@g.us') < 0 && jid !== 'status@broadcast') {
            msgCounts[jid] = (msgCounts[jid] || 0) + 1
          }
        }
        for (var j in msgCounts) {
          if (msgCounts[j] >= 10) {
            altaDemandaJids.push(j)
          }
        }
      } catch (_) {}

      var lastMsgByJid = {}
      try {
        var recentMsgs = $app.findRecordsByFilter(
          'whatsapp_messages',
          'account_id = {:accId}',
          '-timestamp',
          1000,
          0,
          { accId: accountId },
        )
        for (var r = 0; r < recentMsgs.length; r++) {
          var rj = recentMsgs[r].getString('remote_jid')
          if (!rj) continue
          if (!lastMsgByJid[rj]) {
            lastMsgByJid[rj] = {
              last_from_me_ts: 0,
              last_patient_ts: 0,
            }
          }
          var mTs = recentMsgs[r].getInt('timestamp') || 0
          if (recentMsgs[r].getBool('from_me')) {
            if (mTs > lastMsgByJid[rj].last_from_me_ts) lastMsgByJid[rj].last_from_me_ts = mTs
          } else {
            if (mTs > lastMsgByJid[rj].last_patient_ts) lastMsgByJid[rj].last_patient_ts = mTs
          }
        }
      } catch (_) {}
      var rulesById = {}
      try {
        var allRules = $app.findRecordsByFilter(
          'care_followup_rules',
          'id != ""',
          'created',
          500,
          0,
        )
        for (var rl = 0; rl < allRules.length; rl++) {
          rulesById[allRules[rl].id] = allRules[rl].getInt('followup_days') || 10
        }
      } catch (_) {}

      var nowIso = new Date().toISOString()
      var threeMonthsAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

      var allAppts = []
      try {
        allAppts = $app.findRecordsByFilter(
          'appointments',
          'account_id = {:accId} || account_id = "" || account_id = null',
          '-starts_at',
          1000,
          0,
          { accId: accountId },
        )
      } catch (_) {}

      var apptsByPid = {}
      var apptsBySuffix = {}
      for (var apI = 0; apI < allAppts.length; apI++) {
        var apRec = allAppts[apI]
        var apPid = apRec.getString('patient_id')
        var apP = (apRec.getString('patient_phone') || '').replace(/\D/g, '')
        var apSuf = apP.length >= 8 ? apP.slice(-8) : ''
        if (apPid) {
          if (!apptsByPid[apPid]) apptsByPid[apPid] = []
          apptsByPid[apPid].push(apRec)
        }
        if (apSuf) {
          if (!apptsBySuffix[apSuf]) apptsBySuffix[apSuf] = []
          apptsBySuffix[apSuf].push(apRec)
        }
      }

      function isPatientCoveredByAgenda(contactRec) {
        var cId = contactRec.id
        var cP = (contactRec.getString('phone') || '').replace(/\D/g, '')
        var cJ = (contactRec.getString('jid') || '').replace(/\D/g, '')
        var sufA = cP.length >= 8 ? cP.slice(-8) : ''
        var sufB = cJ.length >= 8 ? cJ.slice(-8) : ''

        var candidateAppts = []
        if (apptsByPid[cId]) candidateAppts = candidateAppts.concat(apptsByPid[cId])
        if (sufA && apptsBySuffix[sufA]) candidateAppts = candidateAppts.concat(apptsBySuffix[sufA])
        if (sufB && sufB !== sufA && apptsBySuffix[sufB])
          candidateAppts = candidateAppts.concat(apptsBySuffix[sufB])

        for (var ca = 0; ca < candidateAppts.length; ca++) {
          var cand = candidateAppts[ca]
          var sAt = cand.getString('starts_at')
          var st = cand.getString('status')
          if (!sAt) continue
          if (sAt > nowIso && (st === 'agendado' || st === 'confirmado')) return true
          if (sAt <= nowIso && sAt >= threeMonthsAgoIso && st === 'realizado') return true
        }
        return false
      }

      function buildCard(c, effectiveCareStatus) {
        var name =
          c.getString('contact_name') || c.getString('push_name') || c.getString('jid') || 'Contato'
        var stage = c.getString('stage') || ''
        var careStatus =
          effectiveCareStatus !== undefined
            ? effectiveCareStatus
            : c.getString('care_status') || 'em_dia'
        var phone = c.getString('phone') || ''
        var jid = c.getString('jid') || ''
        var instance = c.getString('instance_name') || ''
        var action = c.getString('ai_suggested_action') || ''
        var priority = c.getInt('ai_priority') || 0
        var isPatient = c.getBool('is_patient')
        var convertedAt = c.getString('converted_at') || ''
        var followupRuleId = c.getString('followup_rule_id') || ''
        var followupDays = 10
        if (followupRuleId && rulesById[followupRuleId]) {
          followupDays = rulesById[followupRuleId]
        }

        var lastMsg = lastMsgByJid[jid] || null
        var lastMsgFromMe = lastMsg ? lastMsg.from_me : false
        var lastMsgTs = lastMsg ? lastMsg.timestamp : 0

        return {
          id: c.id,
          name: name,
          phone: phone,
          jid: jid,
          instance_name: instance,
          stage: stage,
          care_status: careStatus,
          ai_suggested_action: action,
          ai_priority: priority,
          is_patient: isPatient,
          converted_at: convertedAt,
          last_message_from_me: lastMsgFromMe,
          last_message_timestamp: lastMsgTs,
          followup_rule_id: followupRuleId,
          followup_days: followupDays,
        }
      }

      for (var i = 0; i < contacts.length; i++) {
        var contact = contacts[i]
        var careStatus = contact.getString('care_status') || 'em_dia'
        var coveredByAgenda = isPatientCoveredByAgenda(contact)

        if (
          coveredByAgenda &&
          (careStatus === 'precisa_retorno' || careStatus === 'precisa_consulta')
        ) {
          careStatus = 'em_dia'
        }

        var card = buildCard(contact, careStatus)

        if (careStatus === 'em_dia') {
          overview.em_dia++
        } else if (careStatus === 'precisa_retorno' && !coveredByAgenda) {
          overview.precisa_retorno++
        }

        var lastSynced = contact.getString('last_synced_at')
        if (lastSynced) {
          var lastTs = Math.floor(new Date(lastSynced.replace(' ', 'T')).getTime() / 1000)
          if (!isNaN(lastTs) && nowTs - lastTs >= 30 * 86400) {
            overview.desassistidos++
          }
        } else if (!lastSynced) {
          var createdTs = Math.floor(new Date(contact.getString('created')).getTime() / 1000)
          if (!isNaN(createdTs) && nowTs - createdTs >= 30 * 86400) {
            overview.desassistidos++
          }
        }

        if (careStatus === 'precisa_retorno' && !coveredByAgenda) {
          groups.precisa_retorno.push(card)
        }

        var mInfo = lastMsgByJid[contact.getString('jid')]
        var isNR = false
        if (mInfo) {
          if (
            mInfo.last_from_me_ts > 0 &&
            mInfo.last_patient_ts <= mInfo.last_from_me_ts &&
            nowTs - mInfo.last_from_me_ts >= 8 * 3600
          ) {
            isNR = true
          }
        } else if (careStatus === 'nao_respondeu') {
          isNR = true
        }
        if (isNR) {
          groups.nao_responderam.push(card)
        }

        var action = contact.getString('ai_suggested_action')
        var priority = contact.getInt('ai_priority') || 0
        if (action && priority >= 5) {
          groups.precisam_de_acao.push(card)
        }

        var stage = contact.getString('stage') || ''
        var convertedAt = contact.getString('converted_at') || ''
        if (stage === 'em_atendimento' && !convertedAt && !coveredByAgenda) {
          groups.precisam_de_consulta.push(card)
        }

        if (convertedAt && contact.getBool('is_patient') && !coveredByAgenda) {
          var convTs = Math.floor(new Date(convertedAt).getTime() / 1000)
          if (!isNaN(convTs)) {
            var daysSince = Math.floor((nowTs - convTs) / 86400)
            var fDays = card.followup_days || 10
            if (daysSince >= fDays && daysSince <= fDays + 5) {
              groups.followup_window.push(card)
            }
          }
        }

        if (altaDemandaJids.indexOf(contact.getString('jid')) >= 0) {
          groups.alta_demanda.push(card)
        }
      }

      groups.precisam_de_acao.sort(function (a, b) {
        return (b.ai_priority || 0) - (a.ai_priority || 0)
      })

      return e.json(200, {
        overview: overview,
        groups: groups,
      })
    } catch (err) {
      $app.logger().error('crm-care-patient-groups error', 'error', String(err))
      return e.json(500, { error: 'Erro ao carregar grupos de pacientes' })
    }
  },
  $apis.requireAuth(),
)
