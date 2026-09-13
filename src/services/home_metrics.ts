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
}

export const fetchHomeMetrics = async (signal?: AbortSignal): Promise<HomeMetricsData> => {
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
    })
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
