import pb from '@/lib/pocketbase/client'
import type { SatisfactionSurvey } from '@/types/models'

export interface SurveySummaryStats {
  totalSent: number
  totalReceived: number
  responseRate: number
  averageScore: number | null
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  recentSurveys: SatisfactionSurvey[]
}

export async function getSatisfactionSummary(accountId: string): Promise<SurveySummaryStats> {
  const result: SurveySummaryStats = {
    totalSent: 0,
    totalReceived: 0,
    responseRate: 0,
    averageScore: null,
    nps: null,
    promoters: 0,
    passives: 0,
    detractors: 0,
    recentSurveys: [],
  }

  if (!accountId) return result

  try {
    // 1. Total sent (agendamentos com survey_sent = true)
    const sentList = await pb.collection('appointments').getList(1, 1, {
      filter: `account_id="${accountId}" && survey_sent=true`,
      requestKey: null,
    })
    result.totalSent = sentList.totalItems

    // 2. Respostas
    const surveys = await pb.collection('satisfaction_surveys').getFullList<SatisfactionSurvey>({
      filter: `account_id="${accountId}"`,
      sort: '-created',
      expand: 'contact_id,appointment_id',
      requestKey: null,
    })
    result.totalReceived = surveys.length
    result.recentSurveys = surveys.slice(0, 10)

    if (result.totalSent > 0) {
      result.responseRate = Math.round((result.totalReceived / result.totalSent) * 100)
    }

    let sum = 0
    let count = 0
    let prom = 0
    let pass = 0
    let det = 0

    for (const s of surveys) {
      if (typeof s.score === 'number' && !isNaN(s.score)) {
        sum += s.score
        count++
        if (s.score >= 9) prom++
        else if (s.score >= 7) pass++
        else det++
      }
    }

    result.promoters = prom
    result.passives = pass
    result.detractors = det

    if (count > 0) {
      result.averageScore = Number((sum / count).toFixed(1))
      result.nps = Math.round(((prom - det) / count) * 100)
    }
  } catch (err) {
    console.error('Erro ao calcular resumo de satisfação:', err)
  }

  return result
}
