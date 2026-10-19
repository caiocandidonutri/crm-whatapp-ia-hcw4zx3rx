routerAdd(
  'GET',
  '/backend/v1/crm/daily-summary',
  (e) => {
    const userId = e.auth && e.auth.id
    if (!userId) return e.unauthorizedError('auth required')

    const accountId = e.auth.get('account_id')
    if (!accountId) return e.json(200, { summary: '', contacts: 0, tasks: 0, pending: 0 })

    try {
      // Início do dia no fuso America/Sao_Paulo (UTC-3)
      const SP_OFFSET_MS = -3 * 3600 * 1000
      const nowUtcMs = Date.now()
      const nowSp = new Date(nowUtcMs + SP_OFFSET_MS)
      const spYear = nowSp.getUTCFullYear()
      const spMonth = nowSp.getUTCMonth()
      const spDate = nowSp.getUTCDate()
      const startOfDay = Math.floor((Date.UTC(spYear, spMonth, spDate) - SP_OFFSET_MS) / 1000)

      const contacts = $app.findRecordsByFilter(
        'crm_contacts',
        'account_id = {:accountId}',
        '-created',
        500,
        0,
        { accountId: accountId },
      )

      const tasks = $app.findRecordsByFilter(
        'tasks',
        'account_id = {:accountId}',
        '-created',
        500,
        0,
        { accountId: accountId },
      )

      const pendingTasks = tasks.filter(function (t) {
        var s = t.getString('status')
        return s === 'pendente' || s === 'em_andamento'
      })

      const overdueTasks = pendingTasks.filter(function (t) {
        var dd = t.getString('due_date')
        if (!dd) return false
        var due = new Date(dd).getTime() / 1000
        return due < startOfDay
      })

      var stageCounts = {}
      for (var i = 0; i < contacts.length; i++) {
        var stage = contacts[i].getString('stage') || 'sem_estagio'
        stageCounts[stage] = (stageCounts[stage] || 0) + 1
      }

      var lines = []
      lines.push('Resumo Diario do CRM')
      lines.push('Contatos totais: ' + contacts.length)
      lines.push('Tarefas totais: ' + tasks.length)
      lines.push('Tarefas pendentes: ' + pendingTasks.length)
      lines.push('Tarefas atrasadas: ' + overdueTasks.length)

      var stageKeys = Object.keys(stageCounts)
      if (stageKeys.length > 0) {
        lines.push('Contatos por estagio:')
        for (var j = 0; j < stageKeys.length; j++) {
          lines.push('  ' + stageKeys[j] + ': ' + stageCounts[stageKeys[j]])
        }
      }

      var priorityTasks = pendingTasks
        .sort(function (a, b) {
          var pa = a.getString('priority')
          var pb = b.getString('priority')
          var order = { urgente: 0, alta: 1, media: 2, baixa: 3 }
          return (order[pa] || 4) - (order[pb] || 4)
        })
        .slice(0, 5)

      if (priorityTasks.length > 0) {
        lines.push('Proximas tarefas prioritarias:')
        for (var k = 0; k < priorityTasks.length; k++) {
          var t = priorityTasks[k]
          lines.push('  - ' + t.getString('title') + ' (' + t.getString('priority') + ')')
        }
      }

      // Conhecimento clínico e contexto do projeto aprovados na Memória
      var kbContext = ''
      try {
        var kbFilter = 'status = "aprovada"'
        if (accountId) kbFilter += ' && account_id = "' + accountId + '"'
        var approvedKb = $app.findRecordsByFilter('knowledge_base', kbFilter, '-updated', 10, 0)
        if (approvedKb && approvedKb.length > 0) {
          var kbList = []
          for (var ki = 0; ki < approvedKb.length; ki++) {
            var kTit = approvedKb[ki].getString('titulo')
            var kResp = approvedKb[ki].getString('resposta')
            if (kTit && kResp) kbList.push('• ' + kTit + ': ' + kResp)
          }
          if (kbList.length > 0) {
            lines.push('\nContexto operacional e regras da clínica:')
            for (var kj = 0; kj < kbList.length; kj++) {
              lines.push(kbList[kj])
            }
          }
        }
      } catch (_) {}

      var summaryText = lines.join('\n')

      var aiSummary = ''
      try {
        var reply = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'system',
              content:
                'Voce e um assistente de CRM. Gere um resumo diario conciso e acionavel em portugues com base nos dados fornecidos. Destaque prioridades e tarefas atrasadas. Maximo 3 paragrafos.',
            },
            {
              role: 'user',
              content: summaryText,
            },
          ],
        })
        aiSummary = reply.choices[0].message.content
      } catch (aiErr) {
        $app.logger().error('AI summary failed', 'error', String(aiErr))
        aiSummary = summaryText
      }

      return e.json(200, {
        summary: aiSummary,
        rawStats: {
          contacts: contacts.length,
          tasks: tasks.length,
          pending: pendingTasks.length,
          overdue: overdueTasks.length,
          stageCounts: stageCounts,
        },
        topTasks: priorityTasks.map(function (t) {
          return {
            id: t.id,
            title: t.getString('title'),
            priority: t.getString('priority'),
            status: t.getString('status'),
            due_date: t.getString('due_date'),
          }
        }),
      })
    } catch (err) {
      $app.logger().error('daily summary error', 'error', String(err))
      return e.json(500, { error: 'Falha ao gerar resumo diario' })
    }
  },
  $apis.requireAuth(),
)
