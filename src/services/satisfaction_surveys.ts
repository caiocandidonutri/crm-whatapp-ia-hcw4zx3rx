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

export const DEFAULT_SURVEY_SUMMARY_STATS: SurveySummaryStats = {
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

export async function getSatisfactionSummary(
  accountId: string,
  signal?: AbortSignal,
  fallback?: SurveySummaryStats,
): Promise<SurveySummaryStats> {
  const safeFallback: SurveySummaryStats = fallback || DEFAULT_SURVEY_SUMMARY_STATS

  if (!accountId) return safeFallback

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let effectiveSignal = signal

  if (!effectiveSignal) {
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), 8000)
    effectiveSignal = controller.signal
  }

  try {
    const result: SurveySummaryStats = {
      ...safeFallback,
      recentSurveys: [...safeFallback.recentSurveys],
    }

    // 1. Total sent (agendamentos com survey_sent = true)
    let totalSent = 0
    try {
      const sentList = await pb.collection('appointments').getList(1, 1, {
        filter: `account_id="${accountId}" && survey_sent=true`,
        signal: effectiveSignal,
        requestKey: null,
      })
      totalSent = sentList?.totalItems || 0
    } catch (sentErr: any) {
      if (sentErr?.isAbort || sentErr?.name === 'AbortError' || effectiveSignal?.aborted) {
        return safeFallback
      }
      console.warn(
        '[getSatisfactionSummary] Falha ao consultar total de pesquisas enviadas:',
        sentErr?.message || sentErr,
      )
    }

    result.totalSent = totalSent

    // 2. Respostas
    let surveys: SatisfactionSurvey[] = []
    try {
      surveys = await pb.collection('satisfaction_surveys').getFullList<SatisfactionSurvey>({
        filter: `account_id="${accountId}"`,
        sort: '-created',
        expand: 'contact_id,appointment_id',
        signal: effectiveSignal,
        requestKey: null,
      })
    } catch (surveyErr: any) {
      if (surveyErr?.isAbort || surveyErr?.name === 'AbortError' || effectiveSignal?.aborted) {
        return safeFallback
      }
      console.warn(
        '[getSatisfactionSummary] Falha ao listar pesquisas de satisfação:',
        surveyErr?.message || surveyErr,
      )
    }

    const safeSurveys = Array.isArray(surveys) ? surveys : []
    result.totalReceived = safeSurveys.length
    result.recentSurveys = safeSurveys.slice(0, 10)

    if (result.totalSent > 0) {
      result.responseRate = Math.round((result.totalReceived / result.totalSent) * 100)
    }

    let sum = 0
    let count = 0
    let prom = 0
    let pass = 0
    let det = 0

    for (const s of safeSurveys) {
      if (typeof s?.score === 'number' && !isNaN(s.score)) {
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

    return result
  } catch (err: any) {
    if (err?.isAbort || err?.name === 'AbortError' || effectiveSignal?.aborted) {
      return safeFallback
    }
    console.warn(
      '[getSatisfactionSummary] Erro ao calcular resumo de satisfação (retornando fallback):',
      err?.message || err,
    )
    return safeFallback
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
