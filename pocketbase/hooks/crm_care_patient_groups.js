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
      var eightHoursAgoTs = nowTs - 8 * 3600

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
          500,
          0,
          { accId: accountId },
        )
        for (var r = 0; r < recentMsgs.length; r++) {
          var rj = recentMsgs[r].getString('remote_jid')
          if (rj && !lastMsgByJid[rj]) {
            lastMsgByJid[rj] = {
              from_me: recentMsgs[r].getBool('from_me'),
              timestamp: recentMsgs[r].getInt('timestamp') || 0,
            }
          }
        }
      } catch (_) {}

      function buildCard(c) {
        var name =
          c.getString('contact_name') || c.getString('push_name') || c.getString('jid') || 'Contato'
        var stage = c.getString('stage') || ''
        var careStatus = c.getString('care_status') || 'em_dia'
        var phone = c.getString('phone') || ''
        var jid = c.getString('jid') || ''
        var instance = c.getString('instance_name') || ''
        var action = c.getString('ai_suggested_action') || ''
        var priority = c.getInt('ai_priority') || 0
        var isPatient = c.getBool('is_patient')
        var convertedAt = c.getString('converted_at') || ''

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
        }
      }

      for (var i = 0; i < contacts.length; i++) {
        var contact = contacts[i]
        var careStatus = contact.getString('care_status') || 'em_dia'
        var card = buildCard(contact)

        if (careStatus === 'em_dia') {
          overview.em_dia++
        } else if (careStatus === 'precisa_retorno') {
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

        if (careStatus === 'precisa_retorno') {
          groups.precisa_retorno.push(card)
        }

        var lm = lastMsgByJid[contact.getString('jid')]
        if (lm && lm.from_me && lm.timestamp > 0 && nowTs - lm.timestamp >= 8 * 3600) {
          groups.nao_responderam.push(card)
        } else if (!lm && careStatus !== 'em_dia') {
          groups.nao_responderam.push(card)
        }

        var action = contact.getString('ai_suggested_action')
        var priority = contact.getInt('ai_priority') || 0
        if (action && priority >= 5) {
          groups.precisam_de_acao.push(card)
        }

        var stage = contact.getString('stage') || ''
        var convertedAt = contact.getString('converted_at') || ''
        if (stage === 'em_atendimento' && !convertedAt) {
          groups.precisam_de_consulta.push(card)
        }

        if (convertedAt && contact.getBool('is_patient')) {
          var convTs = Math.floor(new Date(convertedAt).getTime() / 1000)
          if (!isNaN(convTs)) {
            var daysSince = Math.floor((nowTs - convTs) / 86400)
            if (daysSince >= 10 && daysSince <= 15) {
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
