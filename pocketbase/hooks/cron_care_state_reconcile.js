// Cron 15 min: Recalcula care_state dos contatos com atividade nas últimas 48h
// Escalonamento: minuto 2, 17, 32, 47 (cada 15 min)
// Timeout defensivo: 3-6s
// Grava care_state, care_state_reason, alert_active, last_human_contact_at, last_reconciled_at no contato
// Incrementa alert_drift_fixes em care_alert_settings se houver divergência
// SÓ escrita local no banco — zero chamadas à Evolution, zero envio

cronAdd('cron_care_state_reconcile', '2,17,32,47 * * * *', () => {
  const startTime = Date.now()
  const maxExecutionMs = 4500 // budget 4.5s

  try {
    const now = new Date()
    const nowIso = now.toISOString()
    const fortyEightHoursAgoSec = Math.floor(now.getTime() / 1000) - 48 * 3600
    const fortyEightHoursAgoIso = new Date(now.getTime() - 48 * 3600 * 1000).toISOString()

    // 1. Identificar jids ativos nas últimas 48h
    // Conversas com updated >= 48h ou mensagens recentes
    let candidateJids = []
    try {
      const activeConvs = $app.findRecordsByFilter(
        'conversations',
        'last_message_timestamp >= {:ts} || updated >= {:iso}',
        '-last_message_timestamp',
        100,
        0,
        { ts: fortyEightHoursAgoSec, iso: fortyEightHoursAgoIso },
      )
      for (let ci = 0; ci < activeConvs.length; ci++) {
        const j = activeConvs[ci].getString('remote_jid')
        if (j && candidateJids.indexOf(j) === -1) {
          candidateJids.push(j)
        }
      }
    } catch (_) {}

    // Contatos com last_synced_at recente
    try {
      const activeContacts = $app.findRecordsByFilter(
        'crm_contacts',
        'last_synced_at >= {:iso}',
        '-last_synced_at',
        100,
        0,
        { iso: fortyEightHoursAgoIso },
      )
      for (let cti = 0; cti < activeContacts.length; cti++) {
        const cj = activeContacts[cti].getString('jid')
        if (cj && candidateJids.indexOf(cj) === -1) {
          candidateJids.push(cj)
        }
      }
    } catch (_) {}

    if (candidateJids.length === 0) {
      return
    }

    let driftFixesCount = 0

    // Função de reconciliação determinística pura em JS (Goja)
    function runReconcile(messages, appointments, nowMs) {
      // 1. mensagens
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

      // Regra 1: "responder" (ÚNICO QUE ALERTA)
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

      // Regra 2, 3, 4: consultas
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

      // Regra 2: confirmacao_enviada (<=48h)
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

      // Regra 3: atendido_a_fechar (consulta de hoje cujo horário já passou)
      // Comparar data civil de São Paulo (UTC-3)
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

      // Regra 4: agendado (consulta futura)
      if (futureAppts.length > 0) {
        return {
          state: 'agendado',
          reason: 'Consulta futura agendada',
          lastHumanContactAt: lastHumanContactAt,
          alertActive: false,
        }
      }

      // Regra 5: contatado (humana depois do paciente há < 72h)
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

      // Regra 6: retorno_a_oferecer se já foi atendido no passado
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

      // Regra 7: inativo
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

    // Processar contatos candidatos
    for (let i = 0; i < candidateJids.length; i++) {
      if (Date.now() - startTime > maxExecutionMs) {
        $app.logger().info('cron_care_state_reconcile: timeout budget reached', 'processed', i)
        break
      }

      const jid = candidateJids[i]
      let contact = null
      try {
        contact = $app.findFirstRecordByFilter('crm_contacts', 'jid = {:jid}', { jid: jid })
      } catch (_) {}

      if (!contact) continue

      // Pular os já reconciliados nos últimos 15 minutos se não houve nova mensagem
      const lastRec = contact.getString('last_reconciled_at')
      if (lastRec) {
        const lastRecMs = Date.parse(lastRec)
        // se reconciliado há menos de 10 min, pode pular
        if (!isNaN(lastRecMs) && Date.now() - lastRecMs < 10 * 60 * 1000) {
          continue
        }
      }

      // Buscar mensagens do contato (últimas 30)
      const rawMsgs = []
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

      // Buscar agendamentos do contato (pelo patient_id ou patient_phone)
      const phoneDigits = jid.split('@')[0].replace(/\D/g, '')
      const phoneSuffix = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : phoneDigits
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

      const result = runReconcile(rawMsgs, rawAppts, Date.now())

      const oldState = contact.getString('care_state')
      const oldAlert = contact.getBool('alert_active')
      const oldCareStatus = contact.getString('care_status')

      let dirty = false
      if (oldState !== result.state) {
        contact.set('care_state', result.state)
        contact.set('care_state_reason', result.reason)
        dirty = true
        driftFixesCount++
      }
      if (oldAlert !== result.alertActive) {
        contact.set('alert_active', result.alertActive)
        dirty = true
      }
      if (
        result.lastHumanContactAt &&
        contact.getString('last_human_contact_at') !== result.lastHumanContactAt
      ) {
        contact.set('last_human_contact_at', result.lastHumanContactAt)
        dirty = true
      }

      // Sincronização legada contínua: se care_state é 'retorno_a_oferecer', limpa legado 'precisa_retorno'
      if (result.state === 'retorno_a_oferecer' && oldCareStatus === 'precisa_retorno') {
        contact.set('care_status', 'em_dia')
        dirty = true
      }

      contact.set('last_reconciled_at', nowIso)
      dirty = true

      if (dirty) {
        try {
          $app.saveNoValidate(contact)
        } catch (saveErr) {
          $app
            .logger()
            .warn(
              'cron_care_state_reconcile: contact save failed',
              'jid',
              jid,
              'err',
              String(saveErr),
            )
        }
      }

      // Limpeza contínua de tarefas fantasmas para este contato:
      // Tarefas pendentes com vencimento no passado OU criadas antes de mensagem humana posterior
      try {
        const contactTasks = $app.findRecordsByFilter(
          'tasks',
          "crm_contact_id = {:cid} && (status = 'pendente' || status = 'em_andamento')",
          '-created',
          50,
          0,
          { cid: contact.id },
        )

        for (let ti = 0; ti < contactTasks.length; ti++) {
          const tsk = contactTasks[ti]
          const dueStr = tsk.getString('due_date')
          const dueMs = dueStr ? Date.parse(dueStr) : 0
          const taskCreatedMs = Date.parse(tsk.getString('created')) || 0

          let isOverduePast = dueMs > 0 && dueMs < Date.now() - 60000
          let hasHumanMsgAfter = false
          if (result.lastHumanContactAt) {
            const hMs = Date.parse(result.lastHumanContactAt)
            if (!isNaN(hMs) && hMs > taskCreatedMs) {
              hasHumanMsgAfter = true
            }
          }

          if (
            isOverduePast ||
            hasHumanMsgAfter ||
            (result.state !== 'responder' && tsk.getString('care_category') === 'precisa_atencao')
          ) {
            tsk.set('status', 'resolvida_auto')
            const pDesc = tsk.getString('description') || ''
            const reason = isOverduePast
              ? 'vencimento no passado'
              : hasHumanMsgAfter
                ? 'mensagem humana posterior do contato'
                : 'care_state ' + result.state + ' sem alerta ativo'
            const tag = '[resolvida_auto: ' + reason + ' às ' + nowIso + ']'
            tsk.set('description', pDesc ? pDesc + '\n' + tag : tag)
            tsk.set('completed_at', nowIso)
            try {
              $app.saveNoValidate(tsk)
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // Incrementar alert_drift_fixes em care_alert_settings se houve correção
    if (driftFixesCount > 0) {
      try {
        const settingsList = $app.findRecordsByFilter('care_alert_settings', '', '-created', 1, 0)
        if (settingsList && settingsList.length > 0) {
          const st = settingsList[0]
          const currentFixes = st.getInt('alert_drift_fixes') || 0
          st.set('alert_drift_fixes', currentFixes + driftFixesCount)
          $app.saveNoValidate(st)
        }
      } catch (stErr) {
        $app
          .logger()
          .warn('cron_care_state_reconcile: drift increment failed', 'err', String(stErr))
      }
    }

    $app
      .logger()
      .info(
        'cron_care_state_reconcile: finished',
        'driftFixes',
        driftFixesCount,
        'durationMs',
        Date.now() - startTime,
      )
  } catch (globalErr) {
    $app.logger().error('cron_care_state_reconcile: fatal error', 'err', String(globalErr))
  }
})
