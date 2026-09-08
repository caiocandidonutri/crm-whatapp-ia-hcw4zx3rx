routerAdd(
  'GET',
  '/backend/v1/crm/followup-report',
  (e) => {
    try {
      var userId = e.auth && e.auth.id
      if (!userId) {
        return e.json(401, { error: 'Autenticação necessária' })
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
          days: 30,
          summary: {
            total_recovered: 0,
            total_pending: 0,
            recovery_rate: 0,
          },
          rules: [],
          recent_recovered: [],
        })
      }

      var daysParam = parseInt(e.request.url.query().get('days') || '30', 10)
      if (daysParam !== 7 && daysParam !== 30) {
        daysParam = 30
      }

      var nowTs = Math.floor(Date.now() / 1000)
      var cutoffSecs = daysParam * 86400
      var cutoffTs = nowTs - cutoffSecs
      var cutoffIso = new Date(cutoffTs * 1000).toISOString().replace('T', ' ')

      // 1. Carregar regras de follow-up da conta
      var rules = []
      try {
        rules = $app.findRecordsByFilter(
          'care_followup_rules',
          'account_id = {:accId}',
          'created',
          100,
          0,
          { accId: accountId },
        )
      } catch (_) {}

      // Se não houver regras salvas na conta, pegar regras existentes no banco ou defaults
      if (rules.length === 0) {
        try {
          rules = $app.findRecordsByFilter('care_followup_rules', "id != ''", 'created', 100, 0)
        } catch (_) {}
      }

      // 2. Carregar contatos da conta
      var contacts = []
      try {
        contacts = $app.findRecordsByFilter(
          'crm_contacts',
          'account_id = {:accId}',
          '-updated',
          1000,
          0,
          { accId: accountId },
        )
      } catch (_) {}

      var contactById = {}
      for (var cIdx = 0; cIdx < contacts.length; cIdx++) {
        contactById[contacts[cIdx].id] = contacts[cIdx]
      }

      // 3. Carregar tarefas concluídas e totais no período
      // Categorias de follow-up e cuidado: followup_10_15, precisa_retorno, precisa_consulta, etc.
      var allTasks = []
      try {
        allTasks = $app.findRecordsByFilter(
          'tasks',
          'account_id = {:accId} && created >= {:cutoff}',
          '-created',
          2000,
          0,
          { accId: accountId, cutoff: cutoffIso },
        )
      } catch (_) {}

      // Mapear cada regra para seu nome padrão
      // "Consulta inicial (7d)", "Retorno SOP (15d)", "Procedimento hormonal (5d)"
      var ruleStats = {}
      for (var r = 0; r < rules.length; r++) {
        var rId = rules[r].id
        var rName = rules[r].getString('name')
        var rDays = rules[r].getInt('followup_days') || 7
        ruleStats[rId] = {
          id: rId,
          name: rName,
          followup_days: rDays,
          displayName: rName + ' (' + rDays + 'd)',
          created_pending: 0,
          recovered_count: 0,
          recovery_rate: 0,
        }
      }

      // Se tiver regras canônicas mas IDs diferentes, preparar mapa por nome minúsculo
      var defaultRuleNames = [
        { name: 'Consulta inicial', days: 7 },
        { name: 'Retorno de SOP', days: 15 },
        { name: 'Procedimento hormonal', days: 5 },
      ]

      for (var d = 0; d < defaultRuleNames.length; d++) {
        var found = false
        for (var rs in ruleStats) {
          if (
            ruleStats[rs].name.toLowerCase().indexOf(defaultRuleNames[d].name.toLowerCase()) >= 0
          ) {
            found = true
            break
          }
        }
        if (!found) {
          var pseudoId = 'def_' + d
          ruleStats[pseudoId] = {
            id: pseudoId,
            name: defaultRuleNames[d].name,
            followup_days: defaultRuleNames[d].days,
            displayName: defaultRuleNames[d].name + ' (' + defaultRuleNames[d].days + 'd)',
            created_pending: 0,
            recovered_count: 0,
            recovery_rate: 0,
          }
        }
      }

      // Helper para associar contato ou tarefa à regra correspondente
      function matchRuleIdForContact(contact) {
        if (!contact) return Object.keys(ruleStats)[0] || null
        var ruleId = contact.getString('followup_rule_id')
        if (ruleId && ruleStats[ruleId]) return ruleId

        // Heurística baseada no nome/notas ou fallback round-robin
        var notes = (contact.getString('notes') || '').toLowerCase()
        var action = (contact.getString('ai_suggested_action') || '').toLowerCase()
        var fullText = notes + ' ' + action

        for (var rKey in ruleStats) {
          var rObj = ruleStats[rKey]
          if (rObj.name.toLowerCase().indexOf('sop') >= 0 && fullText.indexOf('sop') >= 0) {
            return rKey
          }
          if (
            rObj.name.toLowerCase().indexOf('hormonal') >= 0 &&
            (fullText.indexOf('hormon') >= 0 || fullText.indexOf('implante') >= 0)
          ) {
            return rKey
          }
        }

        // Se for paciente recém-convertido ou follow-up padrão
        for (var rKey2 in ruleStats) {
          if (ruleStats[rKey2].name.toLowerCase().indexOf('consulta inicial') >= 0) {
            return rKey2
          }
        }

        return Object.keys(ruleStats)[0] || null
      }

      var recentRecovered = []
      var seenRecoveredContacts = {}

      // Iterar tarefas no período
      for (var tIdx = 0; tIdx < allTasks.length; tIdx++) {
        var t = allTasks[tIdx]
        var contactId = t.getString('crm_contact_id')
        var contact = contactId ? contactById[contactId] : null
        var targetRuleId = matchRuleIdForContact(contact)

        if (targetRuleId && ruleStats[targetRuleId]) {
          ruleStats[targetRuleId].created_pending++
        }

        var isDone = t.getString('status') === 'concluida'
        if (isDone) {
          if (targetRuleId && ruleStats[targetRuleId]) {
            ruleStats[targetRuleId].recovered_count++
          }

          if (contactId && !seenRecoveredContacts[contactId]) {
            seenRecoveredContacts[contactId] = true
            var patientName = 'Paciente'
            if (contact) {
              patientName =
                contact.getString('contact_name') ||
                contact.getString('push_name') ||
                contact.getString('phone') ||
                'Paciente'
            } else {
              var title = t.getString('title') || ''
              if (title.indexOf(':') >= 0) {
                patientName = title.split(':')[1].trim()
              }
            }

            var recDate =
              t.getString('completed_at') || t.getString('updated') || t.getString('created')
            recentRecovered.push({
              contact_id: contactId,
              name: patientName,
              rule_name: targetRuleId
                ? ruleStats[targetRuleId].displayName
                : 'Follow-up de Cuidado',
              rule_id: targetRuleId || '',
              phone: contact ? contact.getString('phone') || '' : '',
              recovered_at: recDate,
              reason: 'Cuidado concluído com resposta do paciente',
            })
          }
        }
      }

      // Também verificar contatos cuja última resposta do paciente ocorreu após follow-up
      // e o contato está em care_status == 'em_dia' atualizado no período
      for (var cK = 0; cK < contacts.length; cK++) {
        var ct = contacts[cK]
        var updatedStr = ct.getString('updated')
        if (!updatedStr) continue
        var updatedMs = new Date(updatedStr).getTime()
        if (isNaN(updatedMs) || updatedMs < cutoffTs * 1000) continue

        if (
          ct.getBool('is_patient') &&
          ct.getString('care_status') === 'em_dia' &&
          !seenRecoveredContacts[ct.id]
        ) {
          var matchedR = matchRuleIdForContact(ct)
          if (matchedR && ruleStats[matchedR]) {
            ruleStats[matchedR].recovered_count++
            if (ruleStats[matchedR].created_pending < ruleStats[matchedR].recovered_count) {
              ruleStats[matchedR].created_pending = ruleStats[matchedR].recovered_count + 1
            }
          }

          seenRecoveredContacts[ct.id] = true
          var cName =
            ct.getString('contact_name') ||
            ct.getString('push_name') ||
            ct.getString('phone') ||
            'Paciente'
          recentRecovered.push({
            contact_id: ct.id,
            name: cName,
            rule_name: matchedR ? ruleStats[matchedR].displayName : 'Follow-up de Cuidado',
            rule_id: matchedR || '',
            phone: ct.getString('phone') || '',
            recovered_at: updatedStr,
            reason: 'Em dia após retorno/atendimento',
          })
        }
      }

      // Ordenar recuperados por data mais recente
      recentRecovered.sort(function (a, b) {
        return new Date(b.recovered_at).getTime() - new Date(a.recovered_at).getTime()
      })

      // Calcular taxas
      var totalRecovered = 0
      var totalPending = 0
      var rulesList = []

      for (var rKey3 in ruleStats) {
        var rItem = ruleStats[rKey3]
        totalRecovered += rItem.recovered_count
        totalPending += rItem.created_pending

        var rate = 0
        if (rItem.created_pending > 0) {
          rate = Math.round((rItem.recovered_count / rItem.created_pending) * 100)
        } else if (rItem.recovered_count > 0) {
          rate = 100
        }
        rItem.recovery_rate = rate
        rulesList.push(rItem)
      }

      var overallRate = 0
      if (totalPending > 0) {
        overallRate = Math.round((totalRecovered / totalPending) * 100)
      } else if (totalRecovered > 0) {
        overallRate = 100
      }

      return e.json(200, {
        days: daysParam,
        summary: {
          total_recovered: totalRecovered,
          total_pending: totalPending,
          recovery_rate: overallRate,
        },
        rules: rulesList,
        recent_recovered: recentRecovered.slice(0, 20),
      })
    } catch (err) {
      $app.logger().error('crm-followup-report error', 'error', String(err))
      return e.json(500, { error: 'Erro ao gerar relatório de follow-ups' })
    }
  },
  $apis.requireAuth(),
)
