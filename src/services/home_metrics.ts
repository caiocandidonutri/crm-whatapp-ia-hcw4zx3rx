import pb from '@/lib/pocketbase/client'

export interface HomeChartItem {
  label: string
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
    total: number
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

export const fetchHomeMetrics = async (): Promise<HomeMetricsData> => {
  return pb.send<HomeMetricsData>('/backend/v1/home/metrics', { method: 'GET' })
}
