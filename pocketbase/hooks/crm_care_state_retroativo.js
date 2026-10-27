// Endpoint admin: POST /backend/v1/crm/care-state/reconcile-retroativo
// Autenticação: X-CRM-Token existente ou superuser / admin da conta.
// Roda o reconcile determinístico sobre os contatos atuais,
// gravando antes em baseline_snapshots (account_id, collection_name='crm_contacts', record_id, field='care_state', old_value, reason='care-state')
// e devolvendo contagens antes/depois por estado (só números).
// Pendências obsoletas de contatos que não estão mais precisando de ação viram "resolvida_auto".
// Zero chamadas à Evolution, zero envio de mensagem.

routerAdd('POST', '/backend/v1/crm/care-state/reconcile-retroativo', (e) => {
  try {
    // 1. Verificação de Autenticação
    const tokenHeader = e.request.getHeader('X-CRM-Token') || ''
    const hasValidCrmToken = tokenHeader && tokenHeader.trim() === 'crm_agenda_token_dr_caio_2026'

    let isAuthorized = false
    let callerAccount = null

    if (hasValidCrmToken) {
      isAuthorized = true
    } else if (e.auth) {
      try {
        if (e.auth.isSuperuser && e.auth.isSuperuser()) {
          isAuthorized = true
        }
      } catch (_) {}

      if (!isAuthorized) {
        try {
          const member = $app.findFirstRecordByFilter('account_members', 'user_id = {:uid}', {
            uid: e.auth.id,
          })
          if (member) {
            callerAccount = member.getString('account_id')
            const role = member.getString('role')
            if (role === 'owner' || role === 'admin') {
              isAuthorized = true
            }
          }
        } catch (_) {}
      }
    }

    if (!isAuthorized) {
      return e.json(401, {
        error: 'Acesso não autorizado. Envie X-CRM-Token ou credenciais de administrador.',
      })
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const nowMs = now.getTime()

    // 2. Contagens antes
    const countsBefore = {
      responder: 0,
      contatado: 0,
      retorno_a_oferecer: 0,
      agendado: 0,
      confirmacao_enviada: 0,
      atendido_a_fechar: 0,
      inativo: 0,
      sem_estado: 0,
    }

    const countsAfter = {
      responder: 0,
      contatado: 0,
      retorno_a_oferecer: 0,
      agendado: 0,
      confirmacao_enviada: 0,
      atendido_a_fechar: 0,
      inativo: 0,
      sem_estado: 0,
    }

    // Carregar contatos (lote seguro, até 1000)
    let contacts = []
    try {
      contacts = $app.findRecordsByFilter('crm_contacts', 'id != ""', '-updated', 1000, 0)
    } catch (cErr) {
      return e.json(500, { error: 'Erro ao buscar contatos: ' + String(cErr) })
    }

    // Snapshot helper
    const snapCol = $app.findCollectionByNameOrId('baseline_snapshots')
    function recordSnapshot(accountId, recId, field, oldValue) {
      try {
        const snap = new Record(snapCol)
        if (accountId) snap.set('account_id', accountId)
        snap.set('collection_name', 'crm_contacts')
        snap.set('record_id', recId)
        snap.set('field', field)
        snap.set('old_value', oldValue || '')
        snap.set('reason', 'care-state')
        $app.saveNoValidate(snap)
      } catch (sErr) {
        $app.logger().warn('snapshot_save_error', 'recId', recId, 'err', String(sErr))
      }
    }

    // Função interna determinística de reconciliação
    function runReconcile(messages, appointments) {
      let lastPatientMsgTime = null
      let lastHumanContactMs = null
      let lastOutgoingMsgTime = null

      for (let mi = 0; mi < messages.length; mi++) {
        const m = messages[mi]
        const fromMe = m.from_me === true
        const origin = m.origin || ''
        const tMs = m.timeMs || 0

        if (!fromMe) {
          if (lastPatientMsgTime === null || tMs >= lastPatientMsgTime) {
            lastPatientMsgTime = tMs
          }
        } else {
          if (lastOutgoingMsgTime === null || tMs >= lastOutgoingMsgTime) {
            lastOutgoingMsgTime = tMs
          }
          if (origin === 'humano_celular' || origin === 'humano_crm') {
            if (lastHumanContactMs === null || tMs >= lastHumanContactMs) {
              lastHumanContactMs = tMs
            }
          }
        }
      }

      const lastHumanContactAt = lastHumanContactMs
        ? new Date(lastHumanContactMs).toISOString()
        : null

      // 1. responder (único que alerta)
      if (lastPatientMsgTime !== null) {
        const hasResponseAfter =
          lastOutgoingMsgTime !== null && lastOutgoingMsgTime > lastPatientMsgTime
        if (!hasResponseAfter) {
          return {
            state: 'responder',
            reason: 'Última mensagem é do paciente sem resposta posterior da clínica',
            lastHumanContactAt: lastHumanContactAt,
            alertActive: true,
          }
        }
      }

      // Consultas
      const activeAppts = []
      for (let ai = 0; ai < appointments.length; ai++) {
        const st = (appointments[ai].status || '').toLowerCase()
        if (st !== 'cancelado' && st !== 'desmarcado' && st !== 'cancelada') {
          activeAppts.push(appointments[ai])
        }
      }

      const futureAppts = []
      const pastAppts = []
      for (let ai2 = 0; ai2 < activeAppts.length; ai2++) {
        if (activeAppts[ai2].startsAtMs > nowMs) {
          futureAppts.push(activeAppts[ai2])
        } else {
          pastAppts.push(activeAppts[ai2])
        }
      }
      futureAppts.sort((a, b) => a.startsAtMs - b.startsAtMs)

      // 2. confirmacao_enviada (<=48h)
      if (futureAppts.length > 0) {
        const nextFuture = futureAppts[0]
        const diffHours = (nextFuture.startsAtMs - nowMs) / (1000 * 60 * 60)
        const isConfSent = Boolean(nextFuture.confirmation_sent || nextFuture.reminder_sent)
        if (diffHours <= 48 && isConfSent) {
          return {
            state: 'confirmacao_enviada',
            reason: 'Consulta em menos de 48h com lembrete/confirmação enviado',
            lastHumanContactAt: lastHumanContactAt,
            alertActive: false,
          }
        }
      }

      // 3. atendido_a_fechar (hoje em SP com horário passado)
      function isSameCivilDaySP(t1, t2) {
        const d1 = new Date(t1 - 3 * 3600 * 1000)
        const d2 = new Date(t2 - 3 * 3600 * 1000)
        return (
          d1.getUTCFullYear() === d2.getUTCFullYear() &&
          d1.getUTCMonth() === d2.getUTCMonth() &&
          d1.getUTCDate() === d2.getUTCDate()
        )
      }

      for (let pi = 0; pi < pastAppts.length; pi++) {
        const pAppt = pastAppts[pi]
        if (isSameCivilDaySP(pAppt.startsAtMs, nowMs)) {
          const s = (pAppt.status || '').toLowerCase()
          if (
            s === 'agendado' ||
            s === 'confirmado' ||
            s === 'a_confirmar' ||
            s === '' ||
            s === 'em_andamento'
          ) {
            return {
              state: 'atendido_a_fechar',
              reason: 'Consulta de hoje com horário passado aguardando fechamento',
              lastHumanContactAt: lastHumanContactAt,
              alertActive: false,
            }
          }
        }
      }

      // 4. agendado
      if (futureAppts.length > 0) {
        return {
          state: 'agendado',
          reason: 'Consulta futura agendada',
          lastHumanContactAt: lastHumanContactAt,
          alertActive: false,
        }
      }

      // 5. contatado
      const seventyTwoHoursMs = 72 * 3600 * 1000
      const thirtyDaysMs = 30 * 24 * 3600 * 1000

      if (lastHumanContactMs !== null) {
        const silence = nowMs - lastHumanContactMs
        const humanAfterPatient =
          lastPatientMsgTime === null || lastHumanContactMs >= lastPatientMsgTime
        if (humanAfterPatient && silence <= seventyTwoHoursMs) {
          return {
            state: 'contatado',
            reason: 'Mensagem humana enviada após paciente há menos de 72h',
            lastHumanContactAt: lastHumanContactAt,
            alertActive: false,
          }
        }
        if (silence > seventyTwoHoursMs && silence <= thirtyDaysMs) {
          return {
            state: 'retorno_a_oferecer',
            reason: 'Contato humano realizado com silêncio superior a 72h',
            lastHumanContactAt: lastHumanContactAt,
            alertActive: false,
          }
        }
      }

      // 6. retorno_a_oferecer se já realizou consulta no passado
      for (let pi2 = 0; pi2 < pastAppts.length; pi2++) {
        const st = (pastAppts[pi2].status || '').toLowerCase()
        if (st === 'realizado' || st === 'concluido' || st === 'finalizado' || st === 'atendido') {
          return {
            state: 'retorno_a_oferecer',
            reason: 'Paciente atendido em consulta anterior sem novo agendamento futuro',
            lastHumanContactAt: lastHumanContactAt,
            alertActive: false,
          }
        }
      }

      // 7. inativo
      let lastAnyMsgTime = null
      if (messages.length > 0) {
        lastAnyMsgTime = messages[messages.length - 1].timeMs
      }
      if (lastAnyMsgTime !== null && nowMs - lastAnyMsgTime > thirtyDaysMs) {
        return {
          state: 'inativo',
          reason: 'Sem interação há mais de 30 dias',
          lastHumanContactAt: lastHumanContactAt,
          alertActive: false,
        }
      }
      if (lastAnyMsgTime === null) {
        return {
          state: 'inativo',
          reason: 'Contato sem mensagens registradas',
          lastHumanContactAt: lastHumanContactAt,
          alertActive: false,
        }
      }

      return {
        state: 'contatado',
        reason: 'Mensagem da clínica enviada após paciente',
        lastHumanContactAt: lastHumanContactAt,
        alertActive: false,
      }
    }

    let resolvedObsoleteTasksCount = 0

    // Processar cada contato
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i]
      const curState = contact.getString('care_state') || 'sem_estado'
      if (countsBefore[curState] !== undefined) {
        countsBefore[curState]++
      } else {
        countsBefore.sem_estado++
      }

      const jid = contact.getString('jid')
      const phoneDigits = (contact.getString('phone') || jid.split('@')[0] || '').replace(/\D/g, '')
      const phoneSuffix = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : phoneDigits

      // Mensagens
      const rawMsgs = []
      if (jid) {
        try {
          const ms = $app.findRecordsByFilter(
            'whatsapp_messages',
            'remote_jid = {:jid}',
            '-timestamp',
            30,
            0,
            { jid: jid },
          )
          for (let mi = ms.length - 1; mi >= 0; mi--) {
            const rec = ms[mi]
            const tsSec = rec.getInt('timestamp') || 0
            const tMs =
              tsSec > 0
                ? tsSec < 10000000000
                  ? tsSec * 1000
                  : tsSec
                : Date.parse(rec.getString('created'))
            rawMsgs.push({
              id: rec.id,
              from_me: rec.getBool('from_me'),
              origin: rec.getString('origin') || 'desconhecido',
              timeMs: tMs,
            })
          }
        } catch (_) {}
      }

      // Consultas
      const rawAppts = []
      try {
        let apptFilter = 'patient_id = {:cid}'
        const apptBinds = { cid: contact.id }
        if (phoneSuffix) {
          apptFilter += ' || patient_phone ~ {:suf}'
          apptBinds.suf = phoneSuffix
        }
        const apps = $app.findRecordsByFilter(
          'appointments',
          apptFilter,
          '-starts_at',
          20,
          0,
          apptBinds,
        )
        for (let ai = 0; ai < apps.length; ai++) {
          const a = apps[ai]
          const sAt = a.getString('starts_at')
          const pMs = sAt ? Date.parse(sAt) : null
          if (pMs) {
            rawAppts.push({
              id: a.id,
              startsAtMs: pMs,
              status: a.getString('status'),
              reminder_sent:
                a.getBool('reminder_day_sent_at') || Boolean(a.getString('reminder_day_sent_at')),
              confirmation_sent:
                a.getBool('confirmation_sent_at') || Boolean(a.getString('confirmation_sent_at')),
            })
          }
        }
      } catch (_) {}

      const result = runReconcile(rawMsgs, rawAppts)

      // Gravar baseline_snapshot do care_state anterior se mudou
      const oldCareState = contact.getString('care_state')
      if (oldCareState !== result.state) {
        recordSnapshot(contact.getString('account_id'), contact.id, 'care_state', oldCareState)
        contact.set('care_state', result.state)
        contact.set('care_state_reason', result.reason)
      }

      const oldAlertActive = contact.getBool('alert_active')
      if (oldAlertActive !== result.alertActive) {
        recordSnapshot(
          contact.getString('account_id'),
          contact.id,
          'alert_active',
          String(oldAlertActive),
        )
        contact.set('alert_active', result.alertActive)
      }

      if (result.lastHumanContactAt) {
        contact.set('last_human_contact_at', result.lastHumanContactAt)
      }
      contact.set('last_reconciled_at', nowIso)

      try {
        $app.saveNoValidate(contact)
      } catch (sContactErr) {
        $app
          .logger()
          .warn(
            'reconcile_retroativo: save contact err',
            'id',
            contact.id,
            'err',
            String(sContactErr),
          )
      }

      if (countsAfter[result.state] !== undefined) {
        countsAfter[result.state]++
      } else {
        countsAfter.sem_estado++
      }

      // Pendências obsoletas: se o estado atual não for "responder", tarefas de "nao_respondeu"
      // ou tarefas abertas que já foram resolvidas viram "resolvida_auto"
      if (result.state !== 'responder') {
        try {
          const obsoleteTasks = $app.findRecordsByFilter(
            'tasks',
            "crm_contact_id = {:cid} && (care_category = 'nao_respondeu' || care_category = 'precisa_retorno') && (status = 'pendente' || status = 'em_andamento')",
            '-created',
            50,
            0,
            { cid: contact.id },
          )
          for (let oi = 0; oi < obsoleteTasks.length; oi++) {
            const obT = obsoleteTasks[oi]
            obT.set('status', 'resolvida_auto')
            const pDesc = obT.getString('description') || ''
            const reasonTag =
              '[resolvida_auto: reconciliacao care_state ' + result.state + ' às ' + nowIso + ']'
            obT.set('description', pDesc ? pDesc + '\n' + reasonTag : reasonTag)
            obT.set('completed_at', nowIso)
            $app.saveNoValidate(obT)
            resolvedObsoleteTasksCount++
          }
        } catch (_) {}
      }
    }

    return e.json(200, {
      success: true,
      total_contacts_processed: contacts.length,
      counts_before: countsBefore,
      counts_after: countsAfter,
      resolved_obsolete_tasks_count: resolvedObsoleteTasksCount,
    })
  } catch (fatalErr) {
    $app.logger().error('care_state_reconcile_retroativo fatal', 'err', String(fatalErr))
    return e.json(500, { error: 'Erro fatal na reconciliação retroativa: ' + String(fatalErr) })
  }
})
