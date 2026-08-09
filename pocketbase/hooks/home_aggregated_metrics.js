routerAdd(
  'GET',
  '/backend/v1/home/metrics',
  (e) => {
    var userId = e.auth && e.auth.id
    if (!userId) return e.unauthorizedError('auth required')

    var accountId = ''
    try {
      var member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
        uid: userId,
      })
      accountId = member.getString('account_id')
    } catch (_) {
      return e.json(200, {
        conversations: 0,
        unread: 0,
        messagesToday: 0,
        yesterdayMessages: 0,
        crmContacts: 0,
        crmRecent: 0,
        chart: [],
        tasks: { total: 0, pending: 0, myPending: 0, myOverdue: 0 },
      })
    }

    var instanceName = ''
    try {
      var instance = $app.findFirstRecordByFilter(
        'whatsapp_instances',
        'account_id = {:accId} && status = "connected"',
        '-created',
        1,
        0,
        { accId: accountId },
      )
      instanceName = instance.getString('instance_name')
    } catch (_) {
      try {
        var inst2 = $app.findFirstRecordByFilter(
          'whatsapp_instances',
          'account_id = {:accId}',
          '-created',
          1,
          0,
          { accId: accountId },
        )
        instanceName = inst2.getString('instance_name')
      } catch (_) {}
    }

    var now = new Date()
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    var todayStartSec = Math.floor(startOfToday.getTime() / 1000)
    var todayEndSec = todayStartSec + 86400
    var yesterdayStartSec = todayStartSec - 86400

    var conversations = 0
    var unread = 0
    if (instanceName) {
      var convRow = new DynamicModel({ cnt: 0, unread_sum: 0 })
      try {
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(unread_count AS INTEGER)), 0) as unread_sum FROM conversations WHERE account_id = {:accId} AND instance_name = {:inst} AND (archived = 0 OR archived IS NULL)',
          )
          .bind({ accId: accountId, inst: instanceName })
          .one(convRow)
        conversations = convRow.cnt
        unread = convRow.unread_sum
      } catch (_) {}
    }

    var messagesToday = 0
    var yesterdayMessages = 0
    if (instanceName) {
      var todayRow = new DynamicModel({ cnt: 0 })
      try {
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND instance_name = {:inst} AND timestamp >= {:start} AND timestamp < {:end}',
          )
          .bind({ accId: accountId, inst: instanceName, start: todayStartSec, end: todayEndSec })
          .one(todayRow)
        messagesToday = todayRow.cnt
      } catch (_) {}
      var yestRow = new DynamicModel({ cnt: 0 })
      try {
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND instance_name = {:inst} AND timestamp >= {:start} AND timestamp < {:end}',
          )
          .bind({
            accId: accountId,
            inst: instanceName,
            start: yesterdayStartSec,
            end: todayStartSec,
          })
          .one(yestRow)
        yesterdayMessages = yestRow.cnt
      } catch (_) {}
    }

    var chart = []
    for (var d = 6; d >= 0; d--) {
      var dayStart = todayStartSec - d * 86400
      var dayEnd = dayStart + 86400
      var dayDate = new Date(dayStart * 1000)
      var label = dayDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
      var sent = 0
      var received = 0
      if (instanceName) {
        var sentRow = new DynamicModel({ cnt: 0 })
        try {
          $app
            .db()
            .newQuery(
              'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND instance_name = {:inst} AND timestamp >= {:start} AND timestamp < {:end} AND from_me = 1',
            )
            .bind({ accId: accountId, inst: instanceName, start: dayStart, end: dayEnd })
            .one(sentRow)
          sent = sentRow.cnt
        } catch (_) {}
        var recvRow = new DynamicModel({ cnt: 0 })
        try {
          $app
            .db()
            .newQuery(
              'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND instance_name = {:inst} AND timestamp >= {:start} AND timestamp < {:end} AND from_me = 0',
            )
            .bind({ accId: accountId, inst: instanceName, start: dayStart, end: dayEnd })
            .one(recvRow)
          received = recvRow.cnt
        } catch (_) {}
      }
      chart.push({
        label: label,
        sent: sent,
        received: received,
        total: sent + received,
      })
    }

    var crmContacts = 0
    var crmRecent = 0
    var crmRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery('SELECT COUNT(*) as cnt FROM crm_contacts WHERE account_id = {:accId}')
        .bind({ accId: accountId })
        .one(crmRow)
      crmContacts = crmRow.cnt
    } catch (_) {}
    var sevenDaysAgoIso = new Date(now.getTime() - 7 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19)
    var crmRecentRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM crm_contacts WHERE account_id = {:accId} AND created >= {:since}',
        )
        .bind({ accId: accountId, since: sevenDaysAgoIso })
        .one(crmRecentRow)
      crmRecent = crmRecentRow.cnt
    } catch (_) {}

    var tasksTotal = 0
    var tasksPending = 0
    var myPending = 0
    var myOverdue = 0
    var taskRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery('SELECT COUNT(*) as cnt FROM tasks WHERE account_id = {:accId}')
        .bind({ accId: accountId })
        .one(taskRow)
      tasksTotal = taskRow.cnt
    } catch (_) {}
    var pendingRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM tasks WHERE account_id = {:accId} AND (status = "pendente" OR status = "em_andamento")',
        )
        .bind({ accId: accountId })
        .one(pendingRow)
      tasksPending = pendingRow.cnt
    } catch (_) {}
    var myPendingRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM tasks WHERE account_id = {:accId} AND assigned_to = {:uid} AND (status = "pendente" OR status = "em_andamento")',
        )
        .bind({ accId: accountId, uid: userId })
        .one(myPendingRow)
      myPending = myPendingRow.cnt
    } catch (_) {}
    var todayIso = startOfToday.toISOString().split('T')[0]
    var myOverdueRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM tasks WHERE account_id = {:accId} AND assigned_to = {:uid} AND (status = "pendente" OR status = "em_andamento") AND due_date IS NOT NULL AND due_date != "" AND due_date < {:today}',
        )
        .bind({ accId: accountId, uid: userId, today: todayIso })
        .one(myOverdueRow)
      myOverdue = myOverdueRow.cnt
    } catch (_) {}

    return e.json(200, {
      conversations: conversations,
      unread: unread,
      messagesToday: messagesToday,
      yesterdayMessages: yesterdayMessages,
      crmContacts: crmContacts,
      crmRecent: crmRecent,
      chart: chart,
      tasks: {
        total: tasksTotal,
        pending: tasksPending,
        myPending: myPending,
        myOverdue: myOverdue,
      },
    })
  },
  $apis.requireAuth(),
)
