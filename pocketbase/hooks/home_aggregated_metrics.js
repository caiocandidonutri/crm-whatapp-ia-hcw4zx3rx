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
        funnel: [],
        followupsRecovered7d: 0,
        responseRate8h: { answeredWithin8h: 0, totalAttendantMsgs: 0, ratePct: 100 },
        audios: { transcribed: 0, pending: 0, total: 0 },
        careTasksByCategory: {
          precisa_consulta: 0,
          precisa_atencao: 0,
          nao_respondeu: 0,
          precisa_retorno: 0,
          alta_demanda: 0,
          followup_10_15: 0,
        },
        conversationsStats: { active: 0, archived: 0, total: 0 },
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
    var sevenDaysAgoSec = todayStartSec - 7 * 86400
    var sevenDaysAgoIso = new Date(now.getTime() - 7 * 86400000)
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19)

    // Conversas e não lidas
    var conversations = 0
    var unread = 0
    var convActive = 0
    var convArchived = 0

    var convActiveRow = new DynamicModel({ cnt: 0, unread_sum: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(unread_count AS INTEGER)), 0) as unread_sum FROM conversations WHERE account_id = {:accId} AND (archived = 0 OR archived IS NULL)',
        )
        .bind({ accId: accountId })
        .one(convActiveRow)
      conversations = convActiveRow.cnt
      convActive = convActiveRow.cnt
      unread = convActiveRow.unread_sum
    } catch (_) {}

    var convArchivedRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM conversations WHERE account_id = {:accId} AND archived = 1',
        )
        .bind({ accId: accountId })
        .one(convArchivedRow)
      convArchived = convArchivedRow.cnt
    } catch (_) {}

    // Mensagens Hoje e Ontem (calculado direto por account_id e timestamp em whatsapp_messages)
    var messagesToday = 0
    var yesterdayMessages = 0
    var todayRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND timestamp >= {:start} AND timestamp < {:end}',
        )
        .bind({ accId: accountId, start: todayStartSec, end: todayEndSec })
        .one(todayRow)
      messagesToday = todayRow.cnt
    } catch (_) {}
    var yestRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND timestamp >= {:start} AND timestamp < {:end}',
        )
        .bind({
          accId: accountId,
          start: yesterdayStartSec,
          end: todayStartSec,
        })
        .one(yestRow)
      yesterdayMessages = yestRow.cnt
    } catch (_) {}

    // Gráfico 7 dias (calculado diretamente de whatsapp_messages por account_id e timestamp)
    var chart = []
    for (var d = 6; d >= 0; d--) {
      var dayStart = todayStartSec - d * 86400
      var dayEnd = dayStart + 86400
      var dayDate = new Date(dayStart * 1000)
      var label = dayDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
      var sent = 0
      var received = 0
      var sentRow = new DynamicModel({ cnt: 0 })
      try {
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND timestamp >= {:start} AND timestamp < {:end} AND from_me = 1',
          )
          .bind({ accId: accountId, start: dayStart, end: dayEnd })
          .one(sentRow)
        sent = sentRow.cnt
      } catch (_) {}
      var recvRow = new DynamicModel({ cnt: 0 })
      try {
        $app
          .db()
          .newQuery(
            'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND timestamp >= {:start} AND timestamp < {:end} AND from_me = 0',
          )
          .bind({ accId: accountId, start: dayStart, end: dayEnd })
          .one(recvRow)
        received = recvRow.cnt
      } catch (_) {}
      chart.push({
        label: label,
        sent: sent,
        received: received,
        total: sent + received,
      })
    }

    // Contatos CRM total e recentes (7 dias)
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

    // 1. Pacientes por estágio do funil (Leads → Em atendimento → Cliente / estágios reais)
    var funnel = []
    try {
      var stages = $app.findRecordsByFilter(
        'crm_stages',
        'account_id = {:accId}',
        'position',
        50,
        0,
        { accId: accountId },
      )

      var stageCounts = {}
      var stageQuery = new DynamicModel({ stage: '', cnt: 0 })
      var rows = []
      try {
        rows = $app
          .db()
          .newQuery(
            'SELECT COALESCE(stage, "lead") as stage, COUNT(*) as cnt FROM crm_contacts WHERE account_id = {:accId} GROUP BY stage',
          )
          .bind({ accId: accountId })
          .all()
        for (var rIdx = 0; rIdx < rows.length; rIdx++) {
          var r = rows[rIdx]
          stageCounts[r.stage] = r.cnt
        }
      } catch (_) {}

      if (stages && stages.length > 0) {
        for (var s = 0; s < stages.length; s++) {
          var st = stages[s]
          var key = st.getString('key')
          var lbl = st.getString('label')
          var col = st.getString('color') || 'blue'
          var cnt = stageCounts[key] || 0
          funnel.push({
            key: key,
            label: lbl,
            color: col,
            count: cnt,
          })
        }
      } else {
        // Fallback para estágios padrão
        funnel = [
          { key: 'lead', label: 'Lead', color: 'blue', count: stageCounts['lead'] || 0 },
          {
            key: 'em_atendimento',
            label: 'Em atendimento',
            color: 'amber',
            count: stageCounts['em_atendimento'] || 0,
          },
          {
            key: 'cliente',
            label: 'Cliente',
            color: 'emerald',
            count: stageCounts['cliente'] || 0,
          },
          { key: 'perdido', label: 'Perdido', color: 'rose', count: stageCounts['perdido'] || 0 },
        ]
      }
    } catch (_) {}

    // 2. Follow-ups recuperados na semana (tarefas de follow-up concluídas nos últimos 7 dias)
    var followupsRecovered7d = 0
    var fuRow = new DynamicModel({ cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          "SELECT COUNT(*) as cnt FROM tasks WHERE account_id = {:accId} AND status = 'concluida' AND (completed_at >= {:since} OR (completed_at IS NULL AND updated >= {:since}))",
        )
        .bind({ accId: accountId, since: sevenDaysAgoIso })
        .one(fuRow)
      followupsRecovered7d = fuRow.cnt
    } catch (_) {}

    // 3. Taxa de resposta em até 8h
    // Mensagens do atendente enviadas nos últimos 7 dias: percentual que recebeu resposta do paciente em até 8h
    var answeredWithin8h = 0
    var totalAttendantMsgs = 0
    var ratePct = 100
    try {
      var sampleMsgs = $app.findRecordsByFilter(
        'whatsapp_messages',
        'account_id = {:accId} && from_me = true && timestamp >= {:since}',
        '-timestamp',
        80,
        0,
        { accId: accountId, since: sevenDaysAgoSec },
      )

      if (sampleMsgs && sampleMsgs.length > 0) {
        totalAttendantMsgs = sampleMsgs.length
        for (var mi = 0; mi < sampleMsgs.length; mi++) {
          var aMsg = sampleMsgs[mi]
          var mTs = aMsg.getInt('timestamp')
          var rJid = aMsg.getString('remote_jid')
          if (!mTs || !rJid) continue

          var windowMax = mTs + 8 * 3600
          var replyCheckRow = new DynamicModel({ cnt: 0 })
          try {
            $app
              .db()
              .newQuery(
                'SELECT COUNT(*) as cnt FROM whatsapp_messages WHERE account_id = {:accId} AND remote_jid = {:jid} AND from_me = 0 AND timestamp > {:start} AND timestamp <= {:end}',
              )
              .bind({ accId: accountId, jid: rJid, start: mTs, end: windowMax })
              .one(replyCheckRow)
            if (replyCheckRow.cnt > 0) {
              answeredWithin8h++
            }
          } catch (_) {}
        }

        if (totalAttendantMsgs > 0) {
          ratePct = Math.round((answeredWithin8h / totalAttendantMsgs) * 100)
        }
      }
    } catch (_) {}

    // 4. Áudios transcritos (contador: total transcritos vs pendentes)
    var audiosTranscribed = 0
    var audiosPending = 0
    var audRow = new DynamicModel({ transcribed_cnt: 0, pending_cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT ' +
            "SUM(CASE WHEN transcription IS NOT NULL AND transcription != '' THEN 1 ELSE 0 END) as transcribed_cnt, " +
            "SUM(CASE WHEN transcription IS NULL OR transcription = '' THEN 1 ELSE 0 END) as pending_cnt " +
            'FROM whatsapp_messages ' +
            "WHERE account_id = {:accId} AND (message_type = 'audioMessage' || message_type = 'audio' || message_type = 'ptt' || media_file LIKE '%.ogg' || media_filename LIKE '%.ogg')",
        )
        .bind({ accId: accountId })
        .one(audRow)
      audiosTranscribed = audRow.transcribed_cnt || 0
      audiosPending = audRow.pending_cnt || 0
    } catch (_) {}

    // 5. Pendências ativas por categoria (precisa_consulta, precisa_atencao, nao_respondeu, precisa_retorno, alta_demanda, followup_10_15)
    var careTasksByCategory = {
      precisa_consulta: 0,
      precisa_atencao: 0,
      nao_respondeu: 0,
      precisa_retorno: 0,
      alta_demanda: 0,
      followup_10_15: 0,
    }
    try {
      var catRows = $app
        .db()
        .newQuery(
          "SELECT care_category, COUNT(*) as cnt FROM tasks WHERE account_id = {:accId} AND (status = 'pendente' OR status = 'em_andamento') AND care_category IS NOT NULL AND care_category != '' AND care_category != 'sem_categoria' GROUP BY care_category",
        )
        .bind({ accId: accountId })
        .all()
      for (var ci = 0; ci < catRows.length; ci++) {
        var cRow = catRows[ci]
        if (careTasksByCategory[cRow.care_category] !== undefined) {
          careTasksByCategory[cRow.care_category] = cRow.cnt
        }
      }
    } catch (_) {}

    // Tarefas gerais
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
      funnel: funnel,
      followupsRecovered7d: followupsRecovered7d,
      responseRate8h: {
        answeredWithin8h: answeredWithin8h,
        totalAttendantMsgs: totalAttendantMsgs,
        ratePct: ratePct,
      },
      audios: {
        transcribed: audiosTranscribed,
        pending: audiosPending,
        total: audiosTranscribed + audiosPending,
      },
      careTasksByCategory: careTasksByCategory,
      conversationsStats: {
        active: convActive,
        archived: convArchived,
        total: convActive + convArchived,
      },
    })
  },
  $apis.requireAuth(),
)
