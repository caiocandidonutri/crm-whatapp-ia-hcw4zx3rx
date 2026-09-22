// @ts-check
/// <reference path="../pb_data/types.d.ts" />

/**
 * Cron mensal para Resumo de Pesquisas de Satisfação para o Dr. Caio.
 * Executa no dia 1º de cada mês às 09:23 (Brasília = 12:23 UTC).
 * Horário escalonado e incomum para evitar colisão.
 * Idempotente: calcula métricas do mês anterior, NPS, top elogios e sugestões,
 * e gera uma TAREFA de alta prioridade na Central de Tarefas para o Dr. Caio / Fabiana.
 */

// RELATÓRIO MENSAL DE SATISFAÇÃO (Executa dia 1 de cada mês às 12:23 UTC = 09:23 Brasília)
// Restaurado da emergência com horário escalonado
cronAdd('cron_monthly_satisfaction_summary', '23 12 1 * *', () => {
  $app.logger().info('cron_monthly_satisfaction_summary: start')

  try {
    var accounts = []
    try {
      accounts = $app.findRecordsByFilter('accounts', '', '-created', 100, 0)
    } catch (_) {}

    // Calcular período do mês anterior
    var nowUtc = new Date()
    var year = nowUtc.getUTCFullYear()
    var month = nowUtc.getUTCMonth() // 0..11 (mês atual)

    // Primeiro dia do mês anterior e último dia do mês anterior
    var prevMonthStart = new Date(
      Date.UTC(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, 1, 0, 0, 0),
    )
    var prevMonthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0))
    var startIso = prevMonthStart.toISOString()
    var endIso = prevMonthEnd.toISOString()

    var monthNames = [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ]
    var prevMonthName =
      monthNames[prevMonthStart.getUTCMonth()] + '/' + prevMonthStart.getUTCFullYear()

    for (var a = 0; a < accounts.length; a++) {
      var acc = accounts[a]
      var accId = acc.id

      // 1. Total de pesquisas enviadas no mês anterior (via appointments survey_sent_at)
      var sentAppointments = []
      try {
        sentAppointments = $app.findRecordsByFilter(
          'appointments',
          'account_id = {:aid} && survey_sent = true && survey_sent_at >= {:sIso} && survey_sent_at < {:eIso}',
          '-survey_sent_at',
          500,
          0,
          { aid: accId, sIso: startIso, eIso: endIso },
        )
      } catch (_) {}
      var totalSent = sentAppointments ? sentAppointments.length : 0

      // 2. Respostas recebidas no mês anterior
      var surveys = []
      try {
        surveys = $app.findRecordsByFilter(
          'satisfaction_surveys',
          'account_id = {:aid} && created >= {:sIso} && created < {:eIso}',
          '-created',
          500,
          0,
          { aid: accId, sIso: startIso, eIso: endIso },
        )
      } catch (_) {}

      var totalReceived = surveys ? surveys.length : 0
      if (totalSent === 0 && totalReceived === 0) continue

      var responseRate = totalSent > 0 ? Math.round((totalReceived / totalSent) * 100) : 0

      var sumScore = 0
      var countScores = 0
      var promoters = 0 // 9-10
      var passives = 0 // 7-8
      var detractors = 0 // 0-6
      var compliments = []
      var suggestions = []

      for (var s = 0; s < surveys.length; s++) {
        var item = surveys[s]
        var sc = item.get('score')
        var fb = item.getString('feedback') || ''

        if (sc !== null && sc !== undefined && sc !== '') {
          var numSc = Number(sc)
          if (!isNaN(numSc) && numSc >= 0 && numSc <= 10) {
            sumScore += numSc
            countScores++
            if (numSc >= 9) promoters++
            else if (numSc >= 7) passives++
            else detractors++
          }
        }

        if (fb.trim().length > 3) {
          if (sc >= 8) compliments.push(fb.trim())
          else suggestions.push(fb.trim())
        }
      }

      var avgScore = countScores > 0 ? (sumScore / countScores).toFixed(1) : '-'
      var nps = countScores > 0 ? Math.round(((promoters - detractors) / countScores) * 100) : '-'

      var topCompliments = compliments.slice(0, 3)
      var topSuggestions = suggestions.slice(0, 3)

      var taskTitle = '📊 Resumo Mensal de Satisfação (' + prevMonthName + ') — Dr. Caio'
      var taskDesc =
        'Relatório mensal de satisfação e qualidade dos atendimentos de ' +
        prevMonthName +
        ':\n\n' +
        '• Pesquisas enviadas: ' +
        totalSent +
        '\n• Respostas recebidas: ' +
        totalReceived +
        ' (Taxa: ' +
        responseRate +
        '%)\n' +
        '• Média Geral das Notas: ' +
        avgScore +
        ' / 10\n' +
        '• NPS Estimado: ' +
        nps +
        ' (Promotores: ' +
        promoters +
        ', Neutros: ' +
        passives +
        ', Detratores: ' +
        detractors +
        ')\n\n' +
        '🌟 Top Elogios:\n' +
        (topCompliments.length > 0
          ? topCompliments.map((c, i) => i + 1 + '. "' + c + '"').join('\n')
          : 'Nenhum elogio em texto registrado.') +
        '\n\n💡 Sugestões e Pontos de Atenção:\n' +
        (topSuggestions.length > 0
          ? topSuggestions.map((s, i) => i + 1 + '. "' + s + '"').join('\n')
          : 'Nenhuma reclamação ou sugestão registrada.')

      // Criar a tarefa na Central de Tarefas se ainda não foi gerada para este mês
      try {
        var existingTasks = $app.findRecordsByFilter(
          'tasks',
          'account_id = {:aid} && title = {:title}',
          '-created',
          1,
          0,
          { aid: accId, title: taskTitle },
        )
        if (!existingTasks || existingTasks.length === 0) {
          var taskCol = $app.findCollectionByNameOrId('tasks')
          var tRec = new Record(taskCol)
          tRec.set('account_id', accId)
          tRec.set('title', taskTitle)
          tRec.set('description', taskDesc)
          tRec.set('status', 'pendente')
          tRec.set('priority', 'alta')
          tRec.set('care_category', 'sem_categoria')
          try {
            var mem = $app.findFirstRecordByFilter('account_members', 'account_id = {:aid}', {
              aid: accId,
            })
            if (mem) tRec.set('user_id', mem.getString('user_id'))
          } catch (_) {}
          $app.save(tRec)
          $app
            .logger()
            .info('monthly_satisfaction_task_created', 'account', accId, 'month', prevMonthName)
        }
      } catch (tErr) {
        $app.logger().warn('monthly_satisfaction_task_error', 'err', String(tErr))
      }
    }
  } catch (err) {
    $app.logger().error('cron_monthly_satisfaction_summary_error', 'err', String(err))
  }
})
