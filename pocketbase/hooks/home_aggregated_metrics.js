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
        patientRecall: { detected: 0, sentToday: 0, reengaged: 0 },
        care2Months: { total: 0, contacted: 0, notContacted: 0 },
        unansweredTiers: {
          ate_1h: 0,
          h1_a_4h: 0,
          h4_a_24h: 0,
          h24_a_48h: 0,
          acima_48h: 0,
          total: 0,
        },
        firstResponseAvgMinutes: {
          days7: null,
          days30: null,
        },
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

    // Cálculo de dia baseado no fuso da clínica: America/Sao_Paulo (UTC-3)
    // Mensagens entre 21h e 23h59 de Brasília devem pertencer ao dia local, e não virar dia seguinte.
    var SP_OFFSET_MS = -3 * 3600 * 1000
    var nowUtcMs = Date.now()
    var nowSp = new Date(nowUtcMs + SP_OFFSET_MS)

    // Meia-noite do dia local em America/Sao_Paulo (convertido para UTC timestamp segundos)
    var spYear = nowSp.getUTCFullYear()
    var spMonth = nowSp.getUTCMonth()
    var spDate = nowSp.getUTCDate()
    var todayStartSec = Math.floor(Date.UTC(spYear, spMonth, spDate) / 1000) - SP_OFFSET_MS / 1000
    var todayEndSec = todayStartSec + 86400
    var yesterdayStartSec = todayStartSec - 86400
    var sevenDaysAgoSec = todayStartSec - 7 * 86400
    var sevenDaysAgoIso = new Date(nowUtcMs - 7 * 86400000)
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
    // Agrupamento estrito pelo fuso America/Sao_Paulo
    var chart = []
    for (var d = 6; d >= 0; d--) {
      var dayStart = todayStartSec - d * 86400
      var dayEnd = dayStart + 86400
      // Data local de São Paulo para rótulo
      var dayLocalMs = dayStart * 1000 + SP_OFFSET_MS
      var dayDate = new Date(dayLocalMs)
      // Formato weekday curto determinístico
      var weekdayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
      var wd = weekdayNames[dayDate.getUTCDay()] || 'seg'
      var dayNum = ('0' + dayDate.getUTCDate()).slice(-2)
      var monthNum = ('0' + (dayDate.getUTCMonth() + 1)).slice(-2)
      var label = wd + ' ' + dayNum + '/' + monthNum
      var fullDateStr = dayDate.getUTCFullYear() + '-' + monthNum + '-' + dayNum
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
        weekday: wd,
        date: fullDateStr,
        dayMonth: dayNum + '/' + monthNum,
        dayStartSec: dayStart,
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

    // 4. Áudios transcritos (contador: transcritos válidos vs pendentes elegíveis vs dispensados)
    var audiosTranscribed = 0
    var audiosPending = 0
    var audiosSkipped = 0
    var audRow = new DynamicModel({ transcribed_cnt: 0, pending_cnt: 0, skipped_cnt: 0 })
    try {
      $app
        .db()
        .newQuery(
          'SELECT ' +
            "SUM(CASE WHEN transcription IS NOT NULL AND transcription != '' AND transcription != 'SKIP_NO_TRANSCRIBE' THEN 1 ELSE 0 END) as transcribed_cnt, " +
            "SUM(CASE WHEN transcription IS NULL OR transcription = '' THEN 1 ELSE 0 END) as pending_cnt, " +
            "SUM(CASE WHEN transcription = 'SKIP_NO_TRANSCRIBE' THEN 1 ELSE 0 END) as skipped_cnt " +
            'FROM whatsapp_messages ' +
            "WHERE account_id = {:accId} AND (message_type = 'audioMessage' || message_type = 'audio' || message_type = 'ptt' || media_file LIKE '%.ogg' || media_filename LIKE '%.ogg')",
        )
        .bind({ accId: accountId })
        .one(audRow)
      audiosTranscribed = audRow.transcribed_cnt || 0
      audiosPending = audRow.pending_cnt || 0
      audiosSkipped = audRow.skipped_cnt || 0
    } catch (_) {}

    // 4.1 Uso Diário (Teto diário de transcrições e análises IA)
    var todayDayKey =
      spYear + '-' + ('0' + (spMonth + 1)).slice(-2) + '-' + ('0' + spDate).slice(-2)
    var dailyUsageData = {
      transcriptions_count: 0,
      transcriptions_limit: 150,
      transcriptions_paused: false,
      ai_analyses_count: 0,
      ai_analyses_limit: 200,
      ai_analyses_paused: false,
    }
    try {
      var duFilter = accountId
        ? "day_key = '" + todayDayKey + "' && account_id = '" + accountId + "'"
        : "day_key = '" + todayDayKey + "'"
      var duRec = $app.findFirstRecordByFilter('app_daily_usage', duFilter)
      if (duRec) {
        dailyUsageData.transcriptions_count = duRec.getInt('transcriptions_count') || 0
        dailyUsageData.transcriptions_limit = duRec.getInt('transcriptions_limit') || 150
        dailyUsageData.transcriptions_paused = duRec.getBool('transcriptions_paused') || false
        dailyUsageData.ai_analyses_count = duRec.getInt('ai_analyses_count') || 0
        dailyUsageData.ai_analyses_limit = duRec.getInt('ai_analyses_limit') || 200
        dailyUsageData.ai_analyses_paused = duRec.getBool('ai_analyses_paused') || false
      }
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
      if (catRows && Array.isArray(catRows)) {
        for (var ci = 0; ci < catRows.length; ci++) {
          var cRow = catRows[ci]
          if (cRow && cRow.care_category && careTasksByCategory[cRow.care_category] !== undefined) {
            careTasksByCategory[cRow.care_category] = Number(cRow.cnt) || 0
          }
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

    var todayIso = spYear + '-' + ('0' + (spMonth + 1)).slice(-2) + '-' + ('0' + spDate).slice(-2)
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

    // Métricas de Cuidado dos Últimos 2 Meses (agendamentos dos últimos 60 dias)
    var care2Months = {
      total: 0,
      contacted: 0,
      notContacted: 0,
    }
    try {
      var sixtyDaysAgoIso = new Date(Date.now() - 60 * 86400 * 1000).toISOString()
      var careFilter = accountId
        ? 'starts_at >= {:since} && (account_id = {:accId} || account_id = "" || account_id = null)'
        : 'starts_at >= {:since}'
      var careAppts = $app.findRecordsByFilter(
        'appointments',
        careFilter,
        '-starts_at',
        1000,
        0,
        accountId ? { since: sixtyDaysAgoIso, accId: accountId } : { since: sixtyDaysAgoIso },
      )
      if (careAppts && careAppts.length > 0) {
        care2Months.total = careAppts.length
        for (var cai = 0; cai < careAppts.length; cai++) {
          var ca = careAppts[cai]
          var hasCare = Boolean(
            ca.getString('confirmation_sent_at') ||
            ca.getString('reminder_day_sent_at') ||
            ca.getString('followup_sent_at') ||
            ca.getString('task_created_at'),
          )
          if (hasCare) {
            care2Months.contacted++
          } else {
            care2Months.notContacted++
          }
        }
      }
    } catch (_) {}

    // Métricas de Recall de Pacientes
    var recallDetected = 0
    var recallSentToday = 0
    var recallReengaged = 0
    try {
      // 1. Detectados / elegíveis para recall: clientes ou com is_patient = 1, sem recall enviado
      var detRow = new DynamicModel({ cnt: 0 })
      var detQuery = accountId
        ? 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE (account_id = {:accId} OR account_id = "" OR account_id IS NULL) AND (stage = "cliente" OR is_patient = 1) AND (last_recall_sent_at IS NULL OR last_recall_sent_at = "")'
        : 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE (stage = "cliente" OR is_patient = 1) AND (last_recall_sent_at IS NULL OR last_recall_sent_at = "")'
      var q1 = $app.db().newQuery(detQuery)
      if (accountId) q1.bind({ accId: accountId })
      q1.one(detRow)
      recallDetected = detRow.cnt

      // 2. Enviados hoje: last_recall_sent_at começando com a data de hoje
      var todayPrefix = todayIso + '%'
      var sentRow = new DynamicModel({ cnt: 0 })
      var sentQuery = accountId
        ? 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE (account_id = {:accId} OR account_id = "" OR account_id IS NULL) AND last_recall_sent_at LIKE {:todayPfx}'
        : 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE last_recall_sent_at LIKE {:todayPfx}'
      var q2 = $app.db().newQuery(sentQuery)
      if (accountId) q2.bind({ accId: accountId, todayPfx: todayPrefix })
      else q2.bind({ todayPfx: todayPrefix })
      q2.one(sentRow)
      recallSentToday = sentRow.cnt

      // 3. Reengajados: recall_count > 0 e status de cuidado em dia ou em atendimento
      var reengRow = new DynamicModel({ cnt: 0 })
      var reengQuery = accountId
        ? 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE (account_id = {:accId} OR account_id = "" OR account_id IS NULL) AND recall_count > 0 AND (stage = "cliente" OR stage = "em_atendimento" OR care_status = "precisa_retorno")'
        : 'SELECT COUNT(*) as cnt FROM crm_contacts WHERE recall_count > 0 AND (stage = "cliente" OR stage = "em_atendimento" OR care_status = "precisa_retorno")'
      var q3 = $app.db().newQuery(reengQuery)
      if (accountId) q3.bind({ accId: accountId })
      q3.one(reengRow)
      recallReengaged = reengRow.cnt
    } catch (_) {}

    // 6. Mensagens recebidas sem resposta por faixa (<1h, 1h-4h, 4h-24h, 24h-48h, >48h)
    // Uma conversa está "sem resposta" se sua última mensagem relevante for from_me = 0 (entrante do paciente).
    var unansweredTiers = {
      ate_1h: 0,
      h1_a_4h: 0,
      h4_a_24h: 0,
      h24_a_48h: 0,
      acima_48h: 0,
      total: 0,
    }

    try {
      var unansweredSql =
        'WITH LastMsgs AS (' +
        '  SELECT remote_jid, MAX(timestamp) as last_ts ' +
        '  FROM whatsapp_messages ' +
        '  WHERE account_id = {:accId} AND remote_jid != "" ' +
        '  GROUP BY remote_jid' +
        '),' +
        'LastMsgDetails AS (' +
        '  SELECT m.remote_jid, m.timestamp, m.from_me ' +
        '  FROM whatsapp_messages m ' +
        '  INNER JOIN LastMsgs lm ON m.account_id = {:accId} AND m.remote_jid = lm.remote_jid AND m.timestamp = lm.last_ts ' +
        '  GROUP BY m.remote_jid' +
        ') ' +
        'SELECT ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) < 3600 THEN 1 ELSE 0 END) as ate_1h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 3600 AND (:nowSec - timestamp) < 14400 THEN 1 ELSE 0 END) as h1_a_4h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 14400 AND (:nowSec - timestamp) < 86400 THEN 1 ELSE 0 END) as h4_a_24h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 86400 AND (:nowSec - timestamp) < 172800 THEN 1 ELSE 0 END) as h24_a_48h, ' +
        '  SUM(CASE WHEN (:nowSec - timestamp) >= 172800 THEN 1 ELSE 0 END) as acima_48h, ' +
        '  COUNT(*) as total ' +
        'FROM LastMsgDetails ' +
        'WHERE from_me = 0'

      var tiersRow = new DynamicModel({
        ate_1h: 0,
        h1_a_4h: 0,
        h4_a_24h: 0,
        h24_a_48h: 0,
        acima_48h: 0,
        total: 0,
      })

      var nowEpochSec = Math.floor(nowUtcMs / 1000)
      $app
        .db()
        .newQuery(unansweredSql)
        .bind({ accId: accountId, nowSec: nowEpochSec })
        .one(tiersRow)

      unansweredTiers.ate_1h = tiersRow.ate_1h || 0
      unansweredTiers.h1_a_4h = tiersRow.h1_a_4h || 0
      unansweredTiers.h4_a_24h = tiersRow.h4_a_24h || 0
      unansweredTiers.h24_a_48h = tiersRow.h24_a_48h || 0
      unansweredTiers.acima_48h = tiersRow.acima_48h || 0
      unansweredTiers.total = tiersRow.total || 0
    } catch (_) {}

    // 7. Tempo médio de primeira resposta (primeira entrante -> primeira resposta da clínica) em 7 e 30 dias
    var firstResponseAvgMinutes = {
      days7: null,
      days30: null,
    }

    try {
      var calcFirstResponseAvg = function (sinceSec) {
        var avgRow = new DynamicModel({ avg_minutes: 0, count: 0 })
        var sql =
          'WITH FirstInbound AS (' +
          '  SELECT remote_jid, MIN(timestamp) as first_in_ts ' +
          '  FROM whatsapp_messages ' +
          '  WHERE account_id = {:accId} AND from_me = 0 AND timestamp >= {:sinceSec} ' +
          '  GROUP BY remote_jid' +
          '),' +
          'FirstOutboundAfter AS (' +
          '  SELECT fi.remote_jid, fi.first_in_ts, MIN(m.timestamp) as first_out_ts ' +
          '  FROM FirstInbound fi ' +
          '  INNER JOIN whatsapp_messages m ON m.account_id = {:accId} AND m.remote_jid = fi.remote_jid AND m.from_me = 1 AND m.timestamp >= fi.first_in_ts ' +
          '  GROUP BY fi.remote_jid, fi.first_in_ts' +
          ') ' +
          'SELECT AVG((first_out_ts - first_in_ts) / 60.0) as avg_minutes, COUNT(*) as count ' +
          'FROM FirstOutboundAfter'

        $app.db().newQuery(sql).bind({ accId: accountId, sinceSec: sinceSec }).one(avgRow)

        if (avgRow.count && avgRow.count > 0 && typeof avgRow.avg_minutes === 'number') {
          return Math.round(avgRow.avg_minutes)
        }
        return null
      }

      var thirtyDaysAgoSec = Math.floor(nowUtcMs / 1000) - 30 * 86400
      var sevenDaysAgoEpochSec = Math.floor(nowUtcMs / 1000) - 7 * 86400

      firstResponseAvgMinutes.days7 = calcFirstResponseAvg(sevenDaysAgoEpochSec)
      firstResponseAvgMinutes.days30 = calcFirstResponseAvg(thirtyDaysAgoSec)
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
        skipped: audiosSkipped,
        total: audiosTranscribed + audiosPending + audiosSkipped,
      },
      dailyUsage: dailyUsageData,
      careTasksByCategory: careTasksByCategory,
      conversationsStats: {
        active: convActive,
        archived: convArchived,
        total: convActive + convArchived,
      },
      patientRecall: {
        detected: recallDetected,
        sentToday: recallSentToday,
        reengaged: recallReengaged,
      },
      care2Months: care2Months,
      unansweredTiers: unansweredTiers,
      firstResponseAvgMinutes: firstResponseAvgMinutes,
    })
  },
  $apis.requireAuth(),
)
