/// <reference path="../pb_data/types.d.ts" />

/**
 * FASE 2 — RÉGUAS DO DR. CAIO
 *
 * Executa 1x por hora no minuto 47 ('47 * * * *')
 *
 * 1. RETORNO 30D:
 *    Paciente de 1ª consulta (is_patient = true) sem retorno agendado:
 *    quando converted_at completar 30 dias (ou retorno_30d_rule atingida) ->
 *    gerar tarefa/alerta de RETORNO. Não conflita com regras pós-consulta imediatas (7/15/5d).
 *
 * 2. ORÇAMENTO 7D:
 *    Quando o contato estiver na etapa 'orcamento_enviado' e budget_sent_at completar 7 dias sem resposta
 *    (ou contato sem resposta há 7 dias) -> tarefa de follow-up de orçamento (prioridade alta) + alerta.
 *
 * 3. RENOVAÇÃO 15D:
 *    Quando plano/clube (plan_expires_at) vencer em 15 dias -> tarefa de renovação (prioridade média/alta).
 *
 * Salvaguardas estritas:
 * - Kill-switch global respeitado
 * - Night Shield (21h-07h de Brasília)
 * - Anti-duplicidade estrita de tarefas
 * - Configurável via care_alert_settings e care_followup_rules
 */

cronAdd('cron_care_reguas_dr_caio', '47 * * * *', () => {
  try {
    // 1. KILL SWITCH GLOBAL
    try {
      var pausedRec = $app.findFirstRecordByFilter(
        'care_alert_settings',
        'global_automations_paused = true',
      )
      if (pausedRec) {
        $app.logger().info('[reguas_dr_caio] Automations paused via global kill-switch')
        return
      }
    } catch (_) {}

    // 2. NIGHT SHIELD (21h-07h Brasília)
    var nowMs = Date.now()
    var spDate = new Date(nowMs - 3 * 3600 * 1000)
    var spHour = spDate.getUTCHours()
    if (spHour >= 21 || spHour < 7) {
      $app.logger().info('[reguas_dr_caio] Night Shield ativo (21h-07h), pulando execução')
      return
    }

    var allSettings = []
    try {
      allSettings = $app.findRecordsByFilter('care_alert_settings', '', '-created', 100, 0)
    } catch (_) {}

    var accounts = []
    try {
      accounts = $app.findRecordsByFilter('accounts', '', '-created', 100, 0)
    } catch (_) {}

    var nowIso = new Date().toISOString()
    var todayStr = spDate.toISOString().split('T')[0]

    for (var a = 0; a < accounts.length; a++) {
      var acc = accounts[a]
      var accountId = acc.id

      // Carregar configurações da conta
      var settings = null
      for (var s = 0; s < allSettings.length; s++) {
        if (allSettings[s].getString('account_id') === accountId) {
          settings = allSettings[s]
          break
        }
      }

      var budgetDaysLimit = (settings && settings.getInt('budget_followup_days')) || 7
      var renewalDaysBefore = (settings && settings.getInt('renewal_alert_days_before')) || 15
      var return30dEnabled = settings ? settings.getBool('return_30d_rule_enabled') : true

      // =========================================================================
      // RÉGUA 2: RETORNO 30D (para paciente de 1ª consulta sem retorno agendado)
      // =========================================================================
      if (return30dEnabled) {
        try {
          // Pacientes com converted_at <= 30 dias atrás
          var cutoff30d = new Date(nowMs - 30 * 86400 * 1000).toISOString().split('T')[0]
          var cutoff45d = new Date(nowMs - 45 * 86400 * 1000).toISOString().split('T')[0]

          var candidatePatients = $app.findRecordsByFilter(
            'crm_contacts',
            'account_id = {:aid} && is_patient = true && converted_at <= {:c30} && converted_at >= {:c45}',
            '-converted_at',
            100,
            0,
            { aid: accountId, c30: cutoff30d, c45: cutoff45d },
          )

          for (var p = 0; p < candidatePatients.length; p++) {
            var pat = candidatePatients[p]
            var patId = pat.id

            // Verificar se o paciente já tem consulta futura agendada ou realizada recentemente
            var hasFutureOrRecentAppt = false
            try {
              var futureAppts = $app.findRecordsByFilter(
                'appointments',
                'account_id = {:aid} && patient_id = {:pid} && (starts_at >= {:today} || status = "agendado" || status = "confirmado")',
                '-starts_at',
                1,
                0,
                { aid: accountId, pid: patId, today: todayStr },
              )
              if (futureAppts && futureAppts.length > 0) {
                hasFutureOrRecentAppt = true
              }
            } catch (_) {}

            if (hasFutureOrRecentAppt) continue

            // DEDUPE: já gerou tarefa de retorno 30d para este contato?
            var dupTask = false
            try {
              var existingTasks = $app.findRecordsByFilter(
                'tasks',
                'account_id = {:aid} && crm_contact_id = {:pid} && care_category = "precisa_retorno"',
                '-created',
                5,
                0,
                { aid: accountId, pid: patId },
              )
              for (var et = 0; et < existingTasks.length; et++) {
                var tTitle = existingTasks[et].getString('title') || ''
                if (tTitle.indexOf('Retorno 30d') !== -1 || tTitle.indexOf('30 dias') !== -1) {
                  dupTask = true
                  break
                }
              }
            } catch (_) {}

            if (dupTask) continue

            // Criar Tarefa de Retorno 30d
            var patName = pat.getString('contact_name') || pat.getString('push_name') || 'Paciente'
            var taskCol = $app.findCollectionByNameOrId('tasks')
            var newTask = new Record(taskCol)
            newTask.set('account_id', accountId)
            newTask.set('user_id', pat.getString('user_id') || acc.getString('owner_id'))
            newTask.set('crm_contact_id', patId)
            newTask.set('title', 'Retorno 30d: ' + patName)
            newTask.set(
              'description',
              'Régua Retorno 30d: paciente completou 30 dias desde a consulta/conversão (' +
                (pat.getString('converted_at') || '30d atrás') +
                ') e ainda não tem retorno agendado. Entrar em contato para agendar o retorno de rotina do Dr. Caio.',
            )
            newTask.set('status', 'pendente')
            newTask.set('priority', 'alta')
            newTask.set('care_category', 'precisa_retorno')
            var due30 = new Date(nowMs + 2 * 86400 * 1000).toISOString()
            newTask.set('due_date', due30)
            if (pat.getString('assigned_to')) {
              newTask.set('assigned_to', pat.getString('assigned_to'))
            }
            $app.save(newTask)

            // Criar Notificação
            try {
              var notifCol = $app.findCollectionByNameOrId('notifications')
              var notif = new Record(notifCol)
              notif.set('account_id', accountId)
              notif.set('user_id', newTask.getString('user_id'))
              notif.set('type', 'task')
              notif.set('title', 'Retorno de 30 dias: ' + patName)
              notif.set(
                'body',
                'Paciente completou 30 dias desde a 1ª consulta sem retorno agendado.',
              )
              notif.set('task_id', newTask.id)
              notif.set('crm_contact_id', patId)
              notif.set('read', false)
              $app.save(notif)
            } catch (_) {}

            $app.logger().info('[reguas_dr_caio] Tarefa Retorno 30d criada', 'contact', patId)
          }
        } catch (r30Err) {
          $app.logger().warn('[reguas_dr_caio] Erro na régua Retorno 30d', 'error', String(r30Err))
        }
      }

      // =========================================================================
      // RÉGUA 4: ORÇAMENTO 7D (etapa orcamento_enviado sem resposta há 7 dias)
      // =========================================================================
      try {
        var budgetCutoffIso = new Date(nowMs - budgetDaysLimit * 86400 * 1000).toISOString()
        var budgetContacts = $app.findRecordsByFilter(
          'crm_contacts',
          'account_id = {:aid} && stage = "orcamento_enviado"',
          '-updated',
          100,
          0,
          { aid: accountId },
        )

        for (var b = 0; b < budgetContacts.length; b++) {
          var bContact = budgetContacts[b]
          var bId = bContact.id
          var sentAt = bContact.getString('budget_sent_at') || bContact.getString('updated')

          if (!sentAt || sentAt > budgetCutoffIso) {
            continue
          }

          // DEDUPE: já existe tarefa pendente/em andamento de follow-up de orçamento?
          var dupBudgetTask = false
          try {
            var bTasks = $app.findRecordsByFilter(
              'tasks',
              'account_id = {:aid} && crm_contact_id = {:cid} && care_category = "precisa_atencao"',
              '-created',
              5,
              0,
              { aid: accountId, cid: bId },
            )
            for (var bt = 0; bt < bTasks.length; bt++) {
              var bTitle = bTasks[bt].getString('title') || ''
              if (
                bTitle.indexOf('Orçamento 7d') !== -1 ||
                bTitle.indexOf('Follow-up Orçamento') !== -1
              ) {
                dupBudgetTask = true
                break
              }
            }
          } catch (_) {}

          if (dupBudgetTask) continue

          var bName =
            bContact.getString('contact_name') || bContact.getString('push_name') || 'Lead'
          var bVal = bContact.getNumber('budget_value')
          var valStr = bVal > 0 ? ' (Valor: R$ ' + bVal.toFixed(2) + ')' : ''

          var tCol = $app.findCollectionByNameOrId('tasks')
          var bTask = new Record(tCol)
          bTask.set('account_id', accountId)
          bTask.set('user_id', bContact.getString('user_id') || acc.getString('owner_id'))
          bTask.set('crm_contact_id', bId)
          bTask.set('title', 'Follow-up Orçamento 7d: ' + bName)
          bTask.set(
            'description',
            'Régua Orçamento 7d: proposta enviada há ' +
              budgetDaysLimit +
              ' dias' +
              valStr +
              ' sem resposta final. Entrar em contato via WhatsApp para tirar dúvidas, alinhar condições e buscar fechamento acolhedor.',
          )
          bTask.set('status', 'pendente')
          bTask.set('priority', 'alta')
          bTask.set('care_category', 'precisa_atencao')
          bTask.set('due_date', new Date(nowMs + 24 * 3600 * 1000).toISOString())
          if (bContact.getString('assigned_to')) {
            bTask.set('assigned_to', bContact.getString('assigned_to'))
          }
          $app.save(bTask)

          // Alerta opcional de follow-up se configurado
          if (settings && settings.getBool('followup_alert_enabled')) {
            try {
              var alertCol = $app.findCollectionByNameOrId('care_alerts')
              var alRec = new Record(alertCol)
              alRec.set('account_id', accountId)
              alRec.set('type', 'followup')
              alRec.set('crm_contact_id', bId)
              alRec.set(
                'message',
                'Orçamento enviado há 7d para ' + bName + valStr + ' aguarda follow-up da equipe.',
              )
              alRec.set('status', 'pending')
              $app.save(alRec)
            } catch (_) {}
          }

          $app.logger().info('[reguas_dr_caio] Tarefa Orçamento 7d criada', 'contact', bId)
        }
      } catch (bErr) {
        $app.logger().warn('[reguas_dr_caio] Erro na régua Orçamento 7d', 'error', String(bErr))
      }

      // =========================================================================
      // RÉGUA 5: RENOVAÇÃO 15D (plan_expires_at vence em 15 dias)
      // =========================================================================
      try {
        var renewalMinIso = new Date(nowMs).toISOString().split('T')[0]
        var renewalMaxIso = new Date(nowMs + renewalDaysBefore * 86400 * 1000)
          .toISOString()
          .split('T')[0]

        var expiringContacts = $app.findRecordsByFilter(
          'crm_contacts',
          'account_id = {:aid} && plan_expires_at != "" && plan_expires_at != null && plan_expires_at >= {:rmin} && plan_expires_at <= {:rmax}',
          '+plan_expires_at',
          100,
          0,
          { aid: accountId, rmin: renewalMinIso, rmax: renewalMaxIso },
        )

        for (var ren = 0; ren < expiringContacts.length; ren++) {
          var renContact = expiringContacts[ren]
          var renId = renContact.id
          var expDate = (renContact.getString('plan_expires_at') || '').split('T')[0]

          // DEDUPE: já existe tarefa de renovação deste plano?
          var dupRenTask = false
          try {
            var rTasks = $app.findRecordsByFilter(
              'tasks',
              'account_id = {:aid} && crm_contact_id = {:cid} && care_category = "precisa_consulta"',
              '-created',
              5,
              0,
              { aid: accountId, cid: renId },
            )
            for (var rt = 0; rt < rTasks.length; rt++) {
              var rtTitle = rTasks[rt].getString('title') || ''
              if (rtTitle.indexOf('Renovação') !== -1) {
                dupRenTask = true
                break
              }
            }
          } catch (_) {}

          if (dupRenTask) continue

          var renName =
            renContact.getString('contact_name') || renContact.getString('push_name') || 'Paciente'
          var renTaskCol = $app.findCollectionByNameOrId('tasks')
          var renTask = new Record(renTaskCol)
          renTask.set('account_id', accountId)
          renTask.set('user_id', renContact.getString('user_id') || acc.getString('owner_id'))
          renTask.set('crm_contact_id', renId)
          renTask.set('title', 'Renovação Plano/Clube: ' + renName)
          renTask.set(
            'description',
            'Régua Renovação 15d: o plano/clube de acompanhamento do paciente vence em ' +
              expDate +
              ' (dentro de ' +
              renewalDaysBefore +
              ' dias). Apresentar continuidade do plano e novas metas com Dr. Caio.',
          )
          renTask.set('status', 'pendente')
          renTask.set('priority', 'alta')
          renTask.set('care_category', 'precisa_consulta')
          renTask.set('due_date', new Date(nowMs + 3 * 86400 * 1000).toISOString())
          if (renContact.getString('assigned_to')) {
            renTask.set('assigned_to', renContact.getString('assigned_to'))
          }
          $app.save(renTask)

          $app.logger().info('[reguas_dr_caio] Tarefa Renovação criada', 'contact', renId)
        }
      } catch (renErr) {
        $app.logger().warn('[reguas_dr_caio] Erro na régua Renovação 15d', 'error', String(renErr))
      }
    }
  } catch (fatalErr) {
    $app.logger().error('[reguas_dr_caio] Erro fatal', 'error', String(fatalErr))
  }
})
