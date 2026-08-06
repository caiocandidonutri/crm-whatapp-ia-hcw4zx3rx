routerAdd(
  'POST',
  '/backend/v1/crm/generate-report',
  (e) => {
    try {
      const userId = e.auth && e.auth.id
      if (!userId) return e.unauthorizedError('auth required')

      let accountId = ''
      try {
        const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:userId}', {
          userId,
        })
        accountId = member.getString('account_id')
      } catch (_) {}

      let contacts = []
      try {
        if (accountId) {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'account_id = {:accountId}',
            '-updated',
            500,
            0,
            { accountId },
          )
        } else {
          contacts = $app.findRecordsByFilter(
            'crm_contacts',
            'user_id = {:userId}',
            '-updated',
            500,
            0,
            { userId },
          )
        }
      } catch (_) {
        return e.json(200, {
          profileOverview: {
            totalContacts: 0,
            stageDistribution: {},
            priorityDistribution: {},
            patientClassification: { patients: 0, nonPatients: 0 },
            categoryGroups: [],
            aiInsights: 'Nenhum contato encontrado para gerar o relatorio.',
          },
          nextActions: [],
          generatedAt: new Date().toISOString(),
        })
      }

      var stageDist = {}
      var priorityDist = { urgente: 0, alta: 0, media: 0, baixa: 0, sem_prioridade: 0 }
      var patientCount = 0
      var nonPatientCount = 0
      var categoryDist = {}

      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i]
        var stage = c.getString('stage') || 'sem_estagio'
        stageDist[stage] = (stageDist[stage] || 0) + 1

        var priority = c.getNumber('ai_priority') || 0
        if (priority >= 8) priorityDist.urgente++
        else if (priority >= 6) priorityDist.alta++
        else if (priority >= 4) priorityDist.media++
        else if (priority >= 1) priorityDist.baixa++
        else priorityDist.sem_prioridade++

        if (c.getBool('is_patient')) patientCount++
        else nonPatientCount++

        var catIds = c.get('category_ids')
        if (typeof catIds === 'string') {
          try {
            catIds = JSON.parse(catIds)
          } catch (_) {
            catIds = []
          }
        }
        if (!Array.isArray(catIds)) catIds = []
        for (var j = 0; j < catIds.length; j++) {
          categoryDist[catIds[j]] = (categoryDist[catIds[j]] || 0) + 1
        }
      }

      var categoryGroups = []
      var catKeys = Object.keys(categoryDist)
      for (var k = 0; k < catKeys.length; k++) {
        var catName = catKeys[k]
        try {
          var cat = $app.findRecordById('categories', catKeys[k])
          catName = cat.getString('name')
        } catch (_) {}
        categoryGroups.push({ id: catKeys[k], name: catName, count: categoryDist[catKeys[k]] })
      }
      categoryGroups.sort(function (a, b) {
        return b.count - a.count
      })

      var sortedContacts = contacts.slice().sort(function (a, b) {
        return (b.getNumber('ai_priority') || 0) - (a.getNumber('ai_priority') || 0)
      })

      var nextActions = []
      for (var m = 0; m < Math.min(sortedContacts.length, 10); m++) {
        var sc = sortedContacts[m]
        var action = sc.getString('ai_suggested_action') || ''
        if (!action) continue
        nextActions.push({
          contactId: sc.id,
          contactName: sc.getString('contact_name') || sc.getString('push_name') || 'Contato',
          action: action,
          priority: sc.getNumber('ai_priority') || 0,
          stage: sc.getString('stage') || '',
          isPatient: sc.getBool('is_patient'),
        })
      }

      var statsText = 'Total de contatos: ' + contacts.length + '\n'
      statsText += 'Distribuicao por estagio: ' + JSON.stringify(stageDist) + '\n'
      statsText += 'Distribuicao por prioridade: ' + JSON.stringify(priorityDist) + '\n'
      statsText += 'Pacientes: ' + patientCount + ', Nao pacientes: ' + nonPatientCount + '\n'
      statsText += 'Categorias: ' + JSON.stringify(categoryGroups) + '\n'
      statsText += 'Top acoes recomendadas: ' + JSON.stringify(nextActions.slice(0, 5)) + '\n'

      var aiInsights = ''
      try {
        var reply = $ai.chat({
          model: 'fast',
          messages: [
            {
              role: 'system',
              content:
                'Voce e um analista de CRM para um nutricionista. Analise os dados abaixo e gere insights acionaveis em portugues. Foque em: 1) Oportunidades de conversao de leads em pacientes, 2) Contatos que precisam de atencao imediata (alta prioridade ou nao respondidos), 3) Tendencias no funil de atendimentos. Maximo 3 paragrafos, seja conciso e direto.',
            },
            { role: 'user', content: statsText },
          ],
        })
        aiInsights = reply.choices[0].message.content
      } catch (aiErr) {
        aiInsights =
          'Nao foi possivel gerar insights com IA no momento. Estatisticas basicas: ' +
          contacts.length +
          ' contatos, ' +
          patientCount +
          ' pacientes, ' +
          nextActions.length +
          ' acoes pendentes.'
      }

      return e.json(200, {
        profileOverview: {
          totalContacts: contacts.length,
          stageDistribution: stageDist,
          priorityDistribution: priorityDist,
          patientClassification: { patients: patientCount, nonPatients: nonPatientCount },
          categoryGroups: categoryGroups,
          aiInsights: aiInsights,
        },
        nextActions: nextActions,
        generatedAt: new Date().toISOString(),
      })
    } catch (err) {
      if (err instanceof SkipAiConfigError)
        return e.json(503, { error: 'IA temporariamente indisponivel' })
      if (err instanceof SkipAiError) {
        var status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'IA temporariamente indisponivel' : err.message,
        })
      }
      return e.json(500, { error: 'Falha ao gerar relatorio' })
    }
  },
  $apis.requireAuth(),
)
