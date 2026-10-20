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

export function isAnyAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as any
    if (
      e.name === 'AbortError' ||
      e.name === 'CanceledError' ||
      e.name === 'TimeoutError' ||
      e.code === 20 ||
      e.code === 'ERR_CANCELED' ||
      e.code === 'ABORT_ERR'
    ) {
      return true
    }
    if (e.isAbort === true) return true
    if (e.status === 0 || e.statusCode === 0) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('signal is aborted') ||
      msg.includes('autocancelled') ||
      msg.includes('canceled') ||
      msg.includes('cancelled') ||
      msg.includes('user aborted') ||
      msg.includes('timeout') ||
      msg.includes('http n/a')
    ) {
      return true
    }
    if (e.originalError && isAnyAbortError(e.originalError)) return true
    if (e.cause && isAnyAbortError(e.cause)) return true
  }
  return false
}

export interface FetchHomeMetricsResult {
  data: HomeMetricsData
  isBackendUnavailable: boolean
  status?: number
  error?: unknown
}

export const fetchHomeMetricsWithStatus = async (
  signal?: AbortSignal,
  fallback?: HomeMetricsData,
): Promise<FetchHomeMetricsResult> => {
  const safeFallback: HomeMetricsData = fallback || DEFAULT_HOME_METRICS

  // Se o sinal externo já foi abortado (desmontagem do componente), retorna silencioso
  if (signal?.aborted) {
    return { data: safeFallback, isBackendUnavailable: false }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }, 12000)

  const onExternalAbort = () => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }

  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    if (signal?.aborted) {
      return { data: safeFallback, isBackendUnavailable: false }
    }

    const token = pb.authStore.token
    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = token
    }

    const data = await pb.send<HomeMetricsData>('/backend/v1/home/metrics', {
      method: 'GET',
      headers,
      signal: controller.signal,
      requestKey: null,
    })

    if (signal?.aborted) {
      return { data: safeFallback, isBackendUnavailable: false }
    }

    if (!data || typeof data !== 'object') {
      return { data: safeFallback, isBackendUnavailable: true }
    }

    return {
      data: {
        ...safeFallback,
        ...data,
        chart: Array.isArray(data.chart) ? data.chart : safeFallback.chart,
        tasks: {
          ...safeFallback.tasks,
          ...(data.tasks || {}),
        },
        funnel: Array.isArray(data.funnel) ? data.funnel : safeFallback.funnel,
        responseRate8h: {
          ...safeFallback.responseRate8h,
          ...(data.responseRate8h || {}),
        },
        audios: {
          ...safeFallback.audios,
          ...(data.audios || {}),
        },
        dailyUsage: {
          ...safeFallback.dailyUsage,
          ...(data.dailyUsage || {}),
        },
        careTasksByCategory: {
          ...safeFallback.careTasksByCategory,
          ...(data.careTasksByCategory || {}),
        },
        conversationsStats: {
          ...safeFallback.conversationsStats,
          ...(data.conversationsStats || {}),
        },
        patientRecall: {
          ...safeFallback.patientRecall,
          ...(data.patientRecall || {}),
        },
        care2Months: {
          ...safeFallback.care2Months,
          ...(data.care2Months || {}),
        },
      },
      isBackendUnavailable: false,
    }
  } catch (err: any) {
    // Se o sinal EXTERNO foi abortado (desmontagem no React 18 StrictMode ou navegação do usuário),
    // é um cancelamento limpo e esperado: retorna silencioso sem erro e sem indisponibilidade.
    if (signal?.aborted) {
      return { data: safeFallback, isBackendUnavailable: false }
    }

    // QUALQUER OUTRA REJEIÇÃO (AbortError por timeout interno, status 0, HTTP N/A, autocancelled,
    // falha de conexão, 502/503/504, erro de JSON, TypeError, etc.):
    // NUNCA propaga throw; retorna o objeto controlado com isBackendUnavailable: true.
    const status = err?.status || err?.response?.status || err?.statusCode
    console.warn(
      `[fetchHomeMetricsWithStatus] Falha segura capturada (backend indisponível, status=${status ?? 'N/A'}):`,
      err?.message || err,
    )

    return {
      data: safeFallback,
      isBackendUnavailable: true,
      status,
      error: err,
    }
  } finally {
    clearTimeout(timeoutId)
    if (signal) {
      try {
        signal.removeEventListener('abort', onExternalAbort)
      } catch {
        /* ignore */
      }
    }
  }
}

export const fetchHomeMetrics = async (
  signal?: AbortSignal,
  fallback?: HomeMetricsData,
): Promise<HomeMetricsData> => {
  try {
    const res = await fetchHomeMetricsWithStatus(signal, fallback)
    return res?.data || fallback || DEFAULT_HOME_METRICS
  } catch {
    return fallback || DEFAULT_HOME_METRICS
  }
}

export const _unusedLegacyFetchHomeMetrics = async (
  signal?: AbortSignal,
  fallback?: HomeMetricsData,
): Promise<HomeMetricsData> => {
  const safeFallback: HomeMetricsData = fallback || DEFAULT_HOME_METRICS

  // Se o sinal já estiver abortado antes do fetch, nem chame o backend
  if (signal?.aborted) {
    return safeFallback
  }

  // Prepara controller com timeout próprio curto de 8s (padrão do projeto)
  // integrado com o signal externo (se fornecido)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }, 8000)

  const onExternalAbort = () => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  }

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId)
      return safeFallback
    }
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    if (signal?.aborted || controller.signal.aborted) {
      return safeFallback
    }

    const token = pb.authStore.token
    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = token
    }

    const data = await pb.send<HomeMetricsData>('/backend/v1/home/metrics', {
      method: 'GET',
      headers,
      signal: controller.signal,
      requestKey: null,
    })

    if (signal?.aborted || controller.signal.aborted) {
      return safeFallback
    }

    if (!data || typeof data !== 'object') {
      return safeFallback
    }

    // Merge defensivo para garantir formato consistente mesmo com resposta parcial
    return {
      ...safeFallback,
      ...data,
      chart: Array.isArray(data.chart) ? data.chart : safeFallback.chart,
      tasks: {
        ...safeFallback.tasks,
        ...(data.tasks || {}),
      },
      funnel: Array.isArray(data.funnel) ? data.funnel : safeFallback.funnel,
      responseRate8h: {
        ...safeFallback.responseRate8h,
        ...(data.responseRate8h || {}),
      },
      audios: {
        ...safeFallback.audios,
        ...(data.audios || {}),
      },
      dailyUsage: {
        ...safeFallback.dailyUsage,
        ...(data.dailyUsage || {}),
      },
      careTasksByCategory: {
        ...safeFallback.careTasksByCategory,
        ...(data.careTasksByCategory || {}),
      },
      conversationsStats: {
        ...safeFallback.conversationsStats,
        ...(data.conversationsStats || {}),
      },
      patientRecall: {
        ...safeFallback.patientRecall,
        ...(data.patientRecall || {}),
      },
      care2Months: {
        ...safeFallback.care2Months,
        ...(data.care2Months || {}),
      },
    }
  } catch (err: any) {
    // Se o erro foi cancelamento/abort de requisição (ex.: desmontagem do componente ou autocancel),
    // ignora silenciosamente sem disparar log no console nem toast
    if (signal?.aborted || controller.signal.aborted || isAnyAbortError(err)) {
      return safeFallback
    }

    // Em QUALQUER falha (502 Bad Gateway, timeout, rede, 400, 404, 500, etc.),
    // NUNCA lança exceção para não derrubar a /home no ErrorBoundary.
    // Retorna valores padrão seguros ou o fallback pré-existente.
    console.warn(
      '[fetchHomeMetrics] Falha ao buscar métricas agregadas da home (retornando fallback):',
      err?.message || err,
    )
    return safeFallback
  } finally {
    clearTimeout(timeoutId)
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort)
    }
  }
}
