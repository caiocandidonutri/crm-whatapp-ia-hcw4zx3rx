routerAdd(
  'GET',
  '/backend/v1/crm-care/dashboard',
  (e) => {
    try {
      // Resposta rápida e defensiva: sem reter socket nem travar a requisição
      var userId = e.auth && e.auth.id
      if (!userId) {
        return e.json(200, {
          attended_today: 0,
          needs_return: 0,
          pending_tasks: 0,
          total_patients: 0,
          funnel: {},
          care_alerts: [],
        })
      }

      var accountId = ''
      try {
        var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
          uid: userId,
        })
        accountId = member.getString('account_id')
      } catch (_) {}

      if (!accountId) {
        return e.json(200, {
          attended_today: 0,
          needs_return: 0,
          pending_tasks: 0,
          total_patients: 0,
          funnel: {},
          care_alerts: [],
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

      var tasks = []
      try {
        tasks = $app.findRecordsByFilter('tasks', 'account_id = {:accId}', '-created', 500, 0, {
          accId: accountId,
        })
      } catch (_) {}

      // Início do dia no fuso America/Sao_Paulo (UTC-3)
      var SP_OFFSET_MS = -3 * 3600 * 1000
      var nowUtcMs = Date.now()
      var nowSp = new Date(nowUtcMs + SP_OFFSET_MS)
      var spYear = nowSp.getUTCFullYear()
      var spMonth = nowSp.getUTCMonth()
      var spDate = nowSp.getUTCDate()
      var todayStartMs = Date.UTC(spYear, spMonth, spDate) - SP_OFFSET_MS

      var nowIso = new Date().toISOString()
      var threeMonthsAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

      // Carregar agendamentos para guiar verificação da agenda em tempo real
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

      var attendedToday = 0
      var needsReturn = 0
      var totalPatients = 0
      var funnel = {}
      var careAlerts = []

      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i]
        var stage = c.getString('stage') || 'sem_estagio'
        funnel[stage] = (funnel[stage] || 0) + 1

        if (c.getBool('is_patient')) totalPatients++

        var updatedStr = c.getString('updated')
        if (updatedStr) {
          var updatedMs = new Date(updatedStr).getTime()
          if (!isNaN(updatedMs) && updatedMs >= todayStartMs) {
            attendedToday++
          }
        }

        var careStatus = c.getString('care_status') || 'em_dia'
        var covered = isPatientCoveredByAgenda(c)

        if (covered && (careStatus === 'precisa_retorno' || careStatus === 'precisa_consulta')) {
          careStatus = 'em_dia'
        }

        if (careStatus === 'precisa_retorno' && !covered) {
          needsReturn++
        }

        if (careStatus && careStatus !== 'em_dia' && !covered) {
          var alertName = c.getString('contact_name') || c.getString('push_name') || 'Contato'
          careAlerts.push({
            id: c.id,
            name: alertName,
            phone: c.getString('phone') || '',
            care_status: careStatus,
            ai_suggested_action: c.getString('ai_suggested_action') || '',
            ai_priority: c.getInt('ai_priority') || 0,
            stage: stage,
          })
        }
      }

      careAlerts.sort(function (a, b) {
        return (b.ai_priority || 0) - (a.ai_priority || 0)
      })

      var pendingTasks = 0
      for (var t = 0; t < tasks.length; t++) {
        var status = tasks[t].getString('status')
        if (status === 'pendente' || status === 'em_andamento') {
          pendingTasks++
        }
      }

      return e.json(200, {
        attended_today: attendedToday,
        needs_return: needsReturn,
        pending_tasks: pendingTasks,
        total_patients: totalPatients,
        funnel: funnel,
        care_alerts: careAlerts.slice(0, 20),
      })
    } catch (err) {
      $app.logger().error('crm-care-dashboard error', 'error', String(err))
      return e.json(500, { error: 'Erro ao carregar dashboard' })
    }
  },
  $apis.requireAuth(),
)
