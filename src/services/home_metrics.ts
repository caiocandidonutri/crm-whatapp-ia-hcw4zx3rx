import pb from '@/lib/pocketbase/client'

export interface HomeChartItem {
  label: string
  weekday?: string
  date?: string
  dayMonth?: string
  dayStartSec?: number
  sent: number
  received: number
  total: number
}

export interface FunnelStageMetric {
  key: string
  label: string
  color: string
  count: number
}

export interface HomeMetricsData {
  conversations: number
  unread: number
  messagesToday: number
  yesterdayMessages: number
  crmContacts: number
  crmRecent: number
  chart: HomeChartItem[]
  tasks: {
    total: number
    pending: number
    myPending: number
    myOverdue: number
  }
  funnel?: FunnelStageMetric[]
  followupsRecovered7d?: number
  responseRate8h?: {
    answeredWithin8h: number
    totalAttendantMsgs: number
    ratePct: number
  }
  audios?: {
    transcribed: number
    pending: number
    skipped?: number
    total: number
  }
  dailyUsage?: {
    transcriptions_count: number
    transcriptions_limit: number
    transcriptions_paused: boolean
    ai_analyses_count: number
    ai_analyses_limit: number
    ai_analyses_paused: boolean
  }
  careTasksByCategory?: {
    precisa_consulta: number
    precisa_atencao: number
    nao_respondeu: number
    precisa_retorno: number
    alta_demanda: number
    followup_10_15: number
  }
  conversationsStats?: {
    active: number
    archived: number
    total: number
  }
  patientRecall?: {
    detected: number
    sentToday: number
    reengaged: number
  }
  care2Months?: {
    total: number
    contacted: number
    notContacted: number
  }
}

export const DEFAULT_HOME_METRICS: HomeMetricsData = {
  conversations: 0,
  unread: 0,
  messagesToday: 0,
  yesterdayMessages: 0,
  crmContacts: 0,
  crmRecent: 0,
  chart: [],
  tasks: {
    total: 0,
    pending: 0,
    myPending: 0,
    myOverdue: 0,
  },
  funnel: [],
  followupsRecovered7d: 0,
  responseRate8h: {
    answeredWithin8h: 0,
    totalAttendantMsgs: 0,
    ratePct: 100,
  },
  audios: {
    transcribed: 0,
    pending: 0,
    skipped: 0,
    total: 0,
  },
  dailyUsage: {
    transcriptions_count: 0,
    transcriptions_limit: 150,
    transcriptions_paused: false,
    ai_analyses_count: 0,
    ai_analyses_limit: 200,
    ai_analyses_paused: false,
  },
  careTasksByCategory: {
    precisa_consulta: 0,
    precisa_atencao: 0,
    nao_respondeu: 0,
    precisa_retorno: 0,
    alta_demanda: 0,
    followup_10_15: 0,
  },
  conversationsStats: {
    active: 0,
    archived: 0,
    total: 0,
  },
  patientRecall: {
    detected: 0,
    sentToday: 0,
    reengaged: 0,
  },
  care2Months: {
    total: 0,
    contacted: 0,
    notContacted: 0,
  },
}

export const fetchHomeMetrics = async (
  signal?: AbortSignal,
  fallback?: HomeMetricsData,
): Promise<HomeMetricsData> => {
  // Timeout de 8s se não houver signal externo fornecido
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let effectiveSignal = signal

  if (!effectiveSignal) {
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), 8000)
    effectiveSignal = controller.signal
  }

  try {
    const token = pb.authStore.token
    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = token
    }

    return await pb.send<HomeMetricsData>('/backend/v1/home/metrics', {
      method: 'GET',
      headers,
      signal: effectiveSignal,
      requestKey: null,
    })
  } catch (err: any) {
    // Se o erro foi cancelamento/abort de requisição (ex.: desmontagem do componente ou autocancel),
    // ignora silenciosamente sem disparar log no console nem toast
    if (err?.isAbort || err?.name === 'AbortError' || effectiveSignal?.aborted) {
      return fallback || DEFAULT_HOME_METRICS
    }
    throw err
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
