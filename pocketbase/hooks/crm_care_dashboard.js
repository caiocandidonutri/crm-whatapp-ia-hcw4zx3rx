routerAdd(
  'GET',
  '/backend/v1/crm-care/dashboard',
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

      var todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      var todayStartMs = todayStart.getTime()

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
        if (careStatus === 'precisa_retorno') {
          needsReturn++
        }

        if (careStatus && careStatus !== 'em_dia') {
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
