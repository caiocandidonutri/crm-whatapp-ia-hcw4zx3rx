/**
 * Helpers compartilhados de data/hora no fuso America/Sao_Paulo (UTC-3)
 * Usados em toda a aplicação para garantir consistência no CRM WhatsApp.
 */

export const CLINIC_TIMEZONE = 'America/Sao_Paulo'
export const TIMEZONE_OFFSET_HOURS = -3

/**
 * Converte qualquer entrada de timestamp/data para um objeto Date válido.
 * Aceita segundos (WhatsApp), millisegundos, strings ISO ou Date.
 */
export function parseToDate(input: number | string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input
  }

  if (typeof input === 'number') {
    if (isNaN(input) || input <= 0) return null
    // Se menor que 1e11 (~nov 1973), está em segundos (epoch do WhatsApp)
    return new Date(input < 1e11 ? input * 1000 : input)
  }

  // Tenta converter se for string numérica
  const num = Number(input)
  if (!isNaN(num) && num > 0) {
    return new Date(num < 1e11 ? num * 1000 : num)
  }

  // String de data (ex.: ISO "2026-09-08 22:07:25" ou "2026-09-08T22:07:25Z")
  const normalized =
    typeof input === 'string' && input.includes(' ') && !input.includes('T')
      ? input.replace(' ', 'T') + (input.endsWith('Z') ? '' : 'Z')
      : input

  const d = new Date(normalized)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Retorna as partes de ano, mês (1-12), dia (1-31), horas, minutos, dia da semana (0-6)
 * calculadas deterministamente no fuso America/Sao_Paulo.
 */
export function getSaoPauloDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'narrow',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    map[p.type] = p.value
  }

  const year = parseInt(map.year, 10)
  const month = parseInt(map.month, 10) // 1 a 12
  const day = parseInt(map.day, 10)
  const hour = parseInt(map.hour || '0', 10)
  const minute = parseInt(map.minute || '0', 10)

  // Chave de dia estrita YYYY-MM-DD no fuso de São Paulo
  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return { year, month, day, hour, minute, dayKey }
}

/**
 * Retorna a chave do dia "YYYY-MM-DD" no fuso da clínica
 */
export function getDayKeySaoPaulo(input: number | string | Date | null | undefined): string {
  const d = parseToDate(input)
  if (!d) return ''
  return getSaoPauloDateParts(d).dayKey
}

/**
 * Retorna a diferença em dias civis (no fuso America/Sao_Paulo) entre uma data e "hoje".
 * 0 = Hoje
 * 1 = Ontem
 * > 1 = Há N dias
 */
export function getDayDiffFromTodaySaoPaulo(date: Date, now: Date = new Date()): number {
  const pTarget = getSaoPauloDateParts(date)
  const pNow = getSaoPauloDateParts(now)

  const utcTarget = Date.UTC(pTarget.year, pTarget.month - 1, pTarget.day)
  const utcNow = Date.UTC(pNow.year, pNow.month - 1, pNow.day)

  const diffMs = utcNow - utcTarget
  return Math.round(diffMs / 86400000)
}

/**
 * Formata apenas a hora no fuso de Brasília ("17:28")
 */
export function formatTimeSaoPaulo(input: number | string | Date | null | undefined): string {
  const d = parseToDate(input)
  if (!d) return ''

  return d.toLocaleTimeString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formata a data no padrão brasileiro ("08/09/2026")
 */
export function formatBrazilianDate(
  input: number | string | Date | null | undefined,
  includeYear = true,
): string {
  const d = parseToDate(input)
  if (!d) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    ...(includeYear ? { year: 'numeric' } : {}),
  })
}

/**
 * Nome do dia da semana por extenso em português no fuso de Brasília.
 * Ex.: "segunda-feira", "terça-feira"
 */
export function getWeekdayLongSaoPaulo(input: number | string | Date | null | undefined): string {
  const d = parseToDate(input)
  if (!d) return ''

  return d.toLocaleDateString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    weekday: 'long',
  })
}

/**
 * Formata data por extenso para tooltips ou cabeçalhos.
 * Ex.: "segunda-feira, 8 de setembro de 2026" ou "segunda-feira, 8 de setembro"
 */
export function formatLongDateSaoPaulo(
  input: number | string | Date | null | undefined,
  includeYear = false,
): string {
  const d = parseToDate(input)
  if (!d) return ''

  const weekday = getWeekdayLongSaoPaulo(d)
  const day = d.toLocaleDateString('pt-BR', { timeZone: CLINIC_TIMEZONE, day: 'numeric' })
  const month = d.toLocaleDateString('pt-BR', { timeZone: CLINIC_TIMEZONE, month: 'long' })
  const year = d.toLocaleDateString('pt-BR', { timeZone: CLINIC_TIMEZONE, year: 'numeric' })

  if (includeYear) {
    return `${weekday}, ${day} de ${month} de ${year}`
  }
  return `${weekday}, ${day} de ${month}`
}

/**
 * Formata data relativa para o card "Atividade Recente" no /home e notificações:
 * - "Hoje 17:28"
 * - "Ontem 09:15"
 * - "seg 08/09 14:30" (se na semana corrente) ou "seg 08/09"
 * - "08/09/2026" para mais antigo
 */
export function formatRecentActivityDate(
  input: number | string | Date | null | undefined,
  includeTimeOnOlder = false,
): string {
  const d = parseToDate(input)
  if (!d) return ''

  const diff = getDayDiffFromTodaySaoPaulo(d)
  const timeStr = formatTimeSaoPaulo(d)

  if (diff === 0) {
    return `Hoje ${timeStr}`
  }

  if (diff === 1) {
    return `Ontem ${timeStr}`
  }

  if (diff > 1 && diff < 7) {
    const weekdayShort = d
      .toLocaleDateString('pt-BR', {
        timeZone: CLINIC_TIMEZONE,
        weekday: 'short',
      })
      .replace('.', '')
    const dayMonth = d.toLocaleDateString('pt-BR', {
      timeZone: CLINIC_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
    })
    return includeTimeOnOlder
      ? `${weekdayShort} ${dayMonth} ${timeStr}`
      : `${weekdayShort} ${dayMonth}`
  }

  // Mais antigo: DD/MM/AAAA
  const fullDate = d.toLocaleDateString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return includeTimeOnOlder ? `${fullDate} ${timeStr}` : fullDate
}

/**
 * Formato do separador de data estilo WhatsApp para conversas (ChatArea):
 * Quando o dia da mensagem muda em relação à anterior:
 * - "HOJE" (se for hoje)
 * - "ONTEM" (se for ontem)
 * - "SEGUNDA-FEIRA", "TERÇA-FEIRA", etc. (se dentro dos últimos 7 dias)
 * - "DD/MM/AAAA" (para datas anteriores a 7 dias)
 */
export function getChatDateSeparatorLabel(
  input: number | string | Date | null | undefined,
): string {
  const d = parseToDate(input)
  if (!d) return ''

  const diff = getDayDiffFromTodaySaoPaulo(d)

  if (diff === 0) {
    return 'HOJE'
  }

  if (diff === 1) {
    return 'ONTEM'
  }

  if (diff > 1 && diff < 7) {
    const weekday = d.toLocaleDateString('pt-BR', {
      timeZone: CLINIC_TIMEZONE,
      weekday: 'long',
    })
    return weekday.toUpperCase()
  }

  // Mais antigo: DD/MM/AAAA
  return d.toLocaleDateString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Formata o timestamp para exibição na lista de conversas (ChatList):
 * - Hoje: "17:28"
 * - Ontem: "Ontem"
 * - Últimos 7 dias: "Segunda-feira" ou "seg"
 * - Mais antigo: "08/09/2026"
 */
export function formatChatListTimestampSaoPaulo(
  input: number | string | Date | null | undefined,
): string {
  const d = parseToDate(input)
  if (!d) return ''

  const diff = getDayDiffFromTodaySaoPaulo(d)

  if (diff === 0) {
    return formatTimeSaoPaulo(d)
  }

  if (diff === 1) {
    return 'Ontem'
  }

  if (diff > 1 && diff < 7) {
    const wd = d
      .toLocaleDateString('pt-BR', {
        timeZone: CLINIC_TIMEZONE,
        weekday: 'short',
      })
      .replace('.', '')
    return wd.charAt(0).toUpperCase() + wd.slice(1)
  }

  return d.toLocaleDateString('pt-BR', {
    timeZone: CLINIC_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
