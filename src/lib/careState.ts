export type CareState =
  | 'responder'
  | 'contatado'
  | 'retorno_a_oferecer'
  | 'agendado'
  | 'confirmacao_enviada'
  | 'atendido_a_fechar'
  | 'inativo'

export interface CareMessageInput {
  id?: string
  from_me?: boolean
  origin?:
    | 'humano_celular'
    | 'humano_crm'
    | 'ia'
    | 'automacao'
    | 'sistema'
    | 'desconhecido'
    | string
  timestamp?: string | number | Date
  created?: string
}

export interface CareAppointmentInput {
  id?: string
  starts_at?: string
  status?: string
  reminder_sent?: boolean
  confirmation_sent?: boolean
}

export interface CarePendenciaInput {
  id?: string
  status?: string
}

export interface ReconcileCareStateParams {
  messages?: CareMessageInput[]
  appointments?: CareAppointmentInput[]
  pendencias?: CarePendenciaInput[]
  now?: Date
}

export interface CareStateResult {
  state: CareState
  reason: string
  lastHumanContactAt: string | null
  alertActive: boolean
}

function parseDate(val: string | number | Date | undefined | null): number | null {
  if (!val) return null
  if (typeof val === 'number') {
    // se for timestamp em segundos (ex: WhatsApp timestamp Unix de 10 dígitos)
    const ms = val < 10000000000 ? val * 1000 : val
    return isNaN(ms) ? null : ms
  }
  if (val instanceof Date) {
    const t = val.getTime()
    return isNaN(t) ? null : t
  }
  const parsed = Date.parse(val)
  return isNaN(parsed) ? null : parsed
}

function isHumanMessage(msg: CareMessageInput): boolean {
  if (!msg.from_me) return false
  return msg.origin === 'humano_celular' || msg.origin === 'humano_crm'
}

function toSaoPauloDateParts(dateMs: number) {
  const d = new Date(dateMs)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(d)
  let year = 0,
    month = 0,
    day = 0,
    hour = 0,
    minute = 0,
    second = 0
  for (const p of parts) {
    if (p.type === 'year') year = parseInt(p.value, 10)
    if (p.type === 'month') month = parseInt(p.value, 10)
    if (p.type === 'day') day = parseInt(p.value, 10)
    if (p.type === 'hour') hour = parseInt(p.value, 10)
    if (p.type === 'minute') minute = parseInt(p.value, 10)
    if (p.type === 'second') second = parseInt(p.value, 10)
  }
  return { year, month, day, hour, minute, second }
}

function isSameDaySP(ms1: number, ms2: number): boolean {
  const p1 = toSaoPauloDateParts(ms1)
  const p2 = toSaoPauloDateParts(ms2)
  return p1.year === p2.year && p1.month === p2.month && p1.day === p2.day
}

/**
 * Reconciliação determinística de estado de cuidado (care state)
 * Ordem de prioridade estrita:
 * 1. "responder": última mensagem é do paciente e não há resposta humana ou da IA posterior (ÚNICO QUE ALERTA).
 * 2. "confirmacao_enviada": consulta futura dentro de <= 48h com confirmação/lembrete enviado.
 * 3. "atendido_a_fechar": consulta de hoje cujo horário já passou (status agendado/confirmado sem conclusão).
 * 4. "agendado": consulta futura (status agendado/confirmado).
 * 5. "contatado": resposta humana posterior à última do paciente, há menos de 72h.
 * 6. "retorno_a_oferecer": contatado com silêncio >72h, OU já atendido no passado sem consulta futura.
 * 7. "inativo": lead sem resposta / sem contato há 30 dias (ou padrão).
 */
export function reconcileCareState(params: ReconcileCareStateParams): CareStateResult {
  const nowMs = params.now ? params.now.getTime() : Date.now()
  const messages = (params.messages || [])
    .map((m) => {
      const rawTime = m.timestamp ?? m.created
      return {
        ...m,
        timeMs: parseDate(rawTime) ?? 0,
      }
    })
    .sort((a, b) => a.timeMs - b.timeMs)

  const appointments = (params.appointments || [])
    .map((a) => ({
      ...a,
      startsAtMs: parseDate(a.starts_at),
    }))
    .filter((a) => a.startsAtMs !== null)

  // Determinar última mensagem geral, última do paciente, última humana, última da IA
  let lastPatientMsgTime: number | null = null
  let lastHumanContactMs: number | null = null
  let lastOutgoingMsgTime: number | null = null

  for (const m of messages) {
    if (!m.from_me) {
      if (lastPatientMsgTime === null || m.timeMs >= lastPatientMsgTime) {
        lastPatientMsgTime = m.timeMs
      }
    } else {
      if (lastOutgoingMsgTime === null || m.timeMs >= lastOutgoingMsgTime) {
        lastOutgoingMsgTime = m.timeMs
      }
      if (isHumanMessage(m)) {
        if (lastHumanContactMs === null || m.timeMs >= lastHumanContactMs) {
          lastHumanContactMs = m.timeMs
        }
      }
    }
  }

  const lastHumanContactAt = lastHumanContactMs ? new Date(lastHumanContactMs).toISOString() : null

  // 1. "responder": Última mensagem é do paciente e não há mensagem posterior do consultório (nem humana nem IA)
  // Caso haja última mensagem do paciente e não haja outgoing após ela:
  if (lastPatientMsgTime !== null) {
    const hasResponseAfter =
      lastOutgoingMsgTime !== null && lastOutgoingMsgTime > lastPatientMsgTime
    if (!hasResponseAfter) {
      return {
        state: 'responder',
        reason: 'Última mensagem é do paciente sem resposta posterior da clínica',
        lastHumanContactAt,
        alertActive: true,
      }
    }
  }

  // Analisar consultas (ignorar canceladas)
  const activeAppointments = appointments.filter((a) => {
    const s = (a.status || '').toLowerCase()
    return s !== 'cancelado' && s !== 'desmarcado' && s !== 'cancelada'
  })

  // Consultas futuras
  const futureAppointments = activeAppointments.filter((a) => a.startsAtMs! > nowMs)
  // Ordena futuras da mais próxima para a mais distante
  futureAppointments.sort((a, b) => a.startsAtMs! - b.startsAtMs!)

  // Consultas passadas
  const pastAppointments = activeAppointments.filter((a) => a.startsAtMs! <= nowMs)

  // Verificar consultas de hoje já passadas (atendido_a_fechar)
  // Consulta de hoje cujo horário já passou e status ainda é agendado/confirmado/pendente
  const passedTodayAppt = pastAppointments.find((a) => {
    const isToday = isSameDaySP(a.startsAtMs!, nowMs)
    const s = (a.status || '').toLowerCase()
    const isPendingClosing =
      s === 'agendado' ||
      s === 'confirmado' ||
      s === 'a_confirmar' ||
      s === '' ||
      s === 'em_andamento'
    return isToday && isPendingClosing
  })

  // Verificar se há consulta futura em <= 48h com confirmação/lembrete enviada
  const nextFuture = futureAppointments[0]
  if (nextFuture) {
    const diffHours = (nextFuture.startsAtMs! - nowMs) / (1000 * 60 * 60)
    const confirmationSent = Boolean(nextFuture.confirmation_sent || nextFuture.reminder_sent)
    if (diffHours <= 48 && confirmationSent) {
      return {
        state: 'confirmacao_enviada',
        reason: `Consulta em menos de 48h (${Math.round(diffHours)}h) com lembrete/confirmação enviado`,
        lastHumanContactAt,
        alertActive: false,
      }
    }
  }

  // 3. "atendido_a_fechar": consulta de hoje cujo horário já passou
  if (passedTodayAppt) {
    return {
      state: 'atendido_a_fechar',
      reason: 'Consulta de hoje com horário passado aguardando fechamento',
      lastHumanContactAt,
      alertActive: false,
    }
  }

  // 4. "agendado": consulta futura
  if (nextFuture) {
    return {
      state: 'agendado',
      reason: `Consulta futura agendada para ${new Date(nextFuture.startsAtMs!).toISOString()}`,
      lastHumanContactAt,
      alertActive: false,
    }
  }

  // Se não tem consulta futura, verificar contato humano e histórico
  // 5. "contatado": humana depois da última do paciente, há menos de 72h
  const seventyTwoHoursMs = 72 * 60 * 60 * 1000
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

  if (lastHumanContactMs !== null) {
    const silenceSinceHuman = nowMs - lastHumanContactMs
    const humanAfterPatient =
      lastPatientMsgTime === null || lastHumanContactMs >= lastPatientMsgTime

    if (humanAfterPatient && silenceSinceHuman <= seventyTwoHoursMs) {
      return {
        state: 'contatado',
        reason: 'Mensagem humana enviada após paciente há menos de 72h',
        lastHumanContactAt,
        alertActive: false,
      }
    }

    if (silenceSinceHuman > seventyTwoHoursMs && silenceSinceHuman <= thirtyDaysMs) {
      return {
        state: 'retorno_a_oferecer',
        reason: 'Contato humano realizado com silêncio superior a 72h',
        lastHumanContactAt,
        alertActive: false,
      }
    }
  }

  // Já foi atendido no passado sem consulta futura?
  const hasCompletedPast = pastAppointments.some((a) => {
    const s = (a.status || '').toLowerCase()
    return s === 'realizado' || s === 'concluido' || s === 'finalizado' || s === 'atendido'
  })

  if (hasCompletedPast) {
    return {
      state: 'retorno_a_oferecer',
      reason: 'Paciente atendido em consulta anterior sem novo agendamento futuro',
      lastHumanContactAt,
      alertActive: false,
    }
  }

  // Se houve qualquer mensagem nos últimos 30 dias mas não caiu nos anteriores:
  const lastAnyMsgTime = messages.length > 0 ? messages[messages.length - 1].timeMs : null
  if (lastAnyMsgTime !== null && nowMs - lastAnyMsgTime > thirtyDaysMs) {
    return {
      state: 'inativo',
      reason: 'Sem interação há mais de 30 dias',
      lastHumanContactAt,
      alertActive: false,
    }
  }

  if (lastAnyMsgTime === null) {
    return {
      state: 'inativo',
      reason: 'Contato sem mensagens registradas',
      lastHumanContactAt,
      alertActive: false,
    }
  }

  // Padrão quando respondido recentemente por IA ou sistema há menos de 72h sem consulta
  return {
    state: 'contatado',
    reason: 'Mensagem da clínica enviada após paciente',
    lastHumanContactAt,
    alertActive: false,
  }
}
