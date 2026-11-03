// pocketbase/hooks/care_state_engine.js
// Módulo de cálculo determinístico de care_state para CRM.
// Compartilhado por whatsapp_touch_crm_contact.js e cron_care_state_reconcile.js
// Exportado via CommonJS module.exports (PocketBase Goja JSVM).

function calculateCareState(messages, appointments, nowMs) {
  if (!nowMs) nowMs = Date.now()
  messages = Array.isArray(messages) ? messages : []
  appointments = Array.isArray(appointments) ? appointments : []

  var lastPatientMsgTime = null
  var lastHumanContactMs = null
  var lastOutgoingMsgTime = null

  for (var mi = 0; mi < messages.length; mi++) {
    var m = messages[mi]
    var fromMe = m.from_me === true
    var origin = m.origin || ''
    var tMs = m.timeMs || 0

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

  var lastHumanContactAt = lastHumanContactMs ? new Date(lastHumanContactMs).toISOString() : null

  // Regra 1: "responder" (ÚNICO QUE ALERTA)
  // Mensagem do paciente (from_me=false) sem resposta posterior da clínica
  if (lastPatientMsgTime !== null) {
    var hasResponseAfter = lastOutgoingMsgTime !== null && lastOutgoingMsgTime > lastPatientMsgTime
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
  var activeAppts = []
  for (var ai = 0; ai < appointments.length; ai++) {
    var st = (appointments[ai].status || '').toLowerCase()
    if (st !== 'cancelado' && st !== 'desmarcado' && st !== 'cancelada') {
      activeAppts.push(appointments[ai])
    }
  }

  var futureAppts = []
  var pastAppts = []
  for (var ai2 = 0; ai2 < activeAppts.length; ai2++) {
    if (activeAppts[ai2].startsAtMs > nowMs) {
      futureAppts.push(activeAppts[ai2])
    } else {
      pastAppts.push(activeAppts[ai2])
    }
  }
  futureAppts.sort(function (a, b) {
    return a.startsAtMs - b.startsAtMs
  })

  // Regra 2: confirmacao_enviada (<=48h)
  if (futureAppts.length > 0) {
    var nextFuture = futureAppts[0]
    var diffHours = (nextFuture.startsAtMs - nowMs) / (1000 * 60 * 60)
    var isConfSent = Boolean(nextFuture.confirmation_sent || nextFuture.reminder_sent)
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
  function isSameCivilDaySP(t1, t2) {
    var d1 = new Date(t1 - 3 * 3600 * 1000)
    var d2 = new Date(t2 - 3 * 3600 * 1000)
    return (
      d1.getUTCFullYear() === d2.getUTCFullYear() &&
      d1.getUTCMonth() === d2.getUTCMonth() &&
      d1.getUTCDate() === d2.getUTCDate()
    )
  }

  for (var pi = 0; pi < pastAppts.length; pi++) {
    var pAppt = pastAppts[pi]
    if (isSameCivilDaySP(pAppt.startsAtMs, nowMs)) {
      var s = (pAppt.status || '').toLowerCase()
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
  var seventyTwoHoursMs = 72 * 3600 * 1000
  var thirtyDaysMs = 30 * 24 * 3600 * 1000

  if (lastHumanContactMs !== null) {
    var silence = nowMs - lastHumanContactMs
    var humanAfterPatient = lastPatientMsgTime === null || lastHumanContactMs >= lastPatientMsgTime
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
  for (var pi2 = 0; pi2 < pastAppts.length; pi2++) {
    var st2 = (pastAppts[pi2].status || '').toLowerCase()
    if (st2 === 'realizado' || st2 === 'concluido' || st2 === 'finalizado' || st2 === 'atendido') {
      return {
        state: 'retorno_a_oferecer',
        reason: 'Paciente atendido em consulta anterior sem novo agendamento futuro',
        lastHumanContactAt: lastHumanContactAt,
        alertActive: false,
      }
    }
  }

  // Regra 7: inativo
  var lastAnyMsgTime = null
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

/**
 * Recalcula e grava o care_state, care_state_reason, alert_active e last_human_contact_at
 * no registro de contato recebido.
 *
 * @param {Record} contact - Record do PocketBase (crm_contacts)
 * @param {Object} [options]
 * @param {Array} [options.messages] - Lista pré-carregada de mensagens
 * @param {Array} [options.appointments] - Lista pré-carregada de consultas
 * @param {number} [options.nowMs]
 * @returns {Object} result - { state, reason, alertActive, lastHumanContactAt, dirty }
 */
function reconcileAndSaveContactCareState(contact, options) {
  if (!contact) return null
  options = options || {}
  var jid = contact.getString('jid')
  var nowMs = options.nowMs || Date.now()
  var nowIso = new Date(nowMs).toISOString().replace('T', ' ')

  var rawMsgs = options.messages
  if (!rawMsgs) {
    rawMsgs = []
    if (jid) {
      try {
        var ms = $app.findRecordsByFilter(
          'whatsapp_messages',
          'remote_jid = {:jid}',
          '-timestamp',
          30,
          0,
          { jid: jid },
        )
        for (var mi = ms.length - 1; mi >= 0; mi--) {
          var rec = ms[mi]
          var tsSec = rec.getInt('timestamp') || 0
          var tMs =
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
  }

  var rawAppts = options.appointments
  if (!rawAppts) {
    rawAppts = []
    var phoneDigits = (contact.getString('phone') || (jid ? jid.split('@')[0] : '')).replace(
      /\D/g,
      '',
    )
    var phoneSuffix = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : phoneDigits
    try {
      var apptFilter = 'patient_id = {:cid}'
      var apptBinds = { cid: contact.id }
      if (phoneSuffix) {
        apptFilter += ' || patient_phone ~ {:suf}'
        apptBinds.suf = phoneSuffix
      }
      var apps = $app.findRecordsByFilter(
        'appointments',
        apptFilter,
        '-starts_at',
        20,
        0,
        apptBinds,
      )
      for (var ai = 0; ai < apps.length; ai++) {
        var a = apps[ai]
        var sAt = a.getString('starts_at')
        var pMs = sAt ? Date.parse(sAt) : null
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
  }

  var result = calculateCareState(rawMsgs, rawAppts, nowMs)

  var oldState = contact.getString('care_state')
  var oldAlert = contact.getBool('alert_active')
  var oldCareStatus = contact.getString('care_status')

  var dirty = false
  if (oldState !== result.state) {
    contact.set('care_state', result.state)
    contact.set('care_state_reason', result.reason)
    dirty = true
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

  // Sincronização legada: se care_state é 'retorno_a_oferecer', limpa legado 'precisa_retorno'
  if (result.state === 'retorno_a_oferecer' && oldCareStatus === 'precisa_retorno') {
    contact.set('care_status', 'em_dia')
    dirty = true
  }

  contact.set('last_reconciled_at', nowIso)
  dirty = true

  try {
    $app.saveNoValidate(contact)
  } catch (saveErr) {
    $app
      .logger()
      .warn('reconcileAndSaveContactCareState: save failed', 'jid', jid, 'err', String(saveErr))
  }

  result.dirty = dirty
  return result
}

module.exports = {
  calculateCareState: calculateCareState,
  reconcileAndSaveContactCareState: reconcileAndSaveContactCareState,
}
