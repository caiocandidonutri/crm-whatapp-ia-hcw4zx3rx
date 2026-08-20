import pb from '@/lib/pocketbase/client'

export interface HomeChartItem {
  label: string
  sent: number
  received: number
  total: number
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
}

export const fetchHomeMetrics = async (): Promise<HomeMetricsData> => {
  return pb.send<HomeMetricsData>('/backend/v1/home/metrics', { method: 'GET' })
}
