import pb from '@/lib/pocketbase/client'

export interface CareDashboardData {
  attended_today: number
  needs_return: number
  pending_tasks: number
  total_patients: number
  funnel: Record<string, number>
  care_alerts: Array<{
    id: string
    name: string
    phone: string
    care_status: string
    ai_suggested_action: string
    ai_priority: number
    stage: string
  }>
}

export interface PatientCard {
  id: string
  name: string
  phone: string
  jid: string
  instance_name: string
  stage: string
  care_status: string
  ai_suggested_action: string
  ai_priority: number
  is_patient: boolean
  converted_at: string
  last_message_from_me: boolean
  last_message_timestamp: number
  followup_rule_id?: string
  followup_days?: number
}

export interface PatientGroupsData {
  overview: {
    em_dia: number
    precisa_retorno: number
    desassistidos: number
  }
  groups: {
    precisa_retorno: PatientCard[]
    nao_responderam: PatientCard[]
    precisam_de_acao: PatientCard[]
    precisam_de_consulta: PatientCard[]
    followup_window: PatientCard[]
    alta_demanda: PatientCard[]
  }
}

export interface PatientGroupFilters {
  period_days?: number
  care_status?: string
  stage?: string
  min_priority?: number
}

export interface ResyncResult {
  success: boolean
  contacts_processed: number
  ai_classified: number
  tasks_created: number
  tasks_updated: number
  tasks_completed: number
}

export async function resyncCareTasks(): Promise<ResyncResult> {
  return pb.send('/backend/v1/crm-care/resync', { method: 'POST' })
}

export function streamCareAgentChat(
  message: string,
  conversationId: string | null,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/crm-care/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token || '' },
    body: JSON.stringify({ message, conversation_id: conversationId }),
    signal,
  })
}

export const DEFAULT_CARE_DASHBOARD: CareDashboardData = {
  attended_today: 0,
  needs_return: 0,
  pending_tasks: 0,
  total_patients: 0,
  funnel: {},
  care_alerts: [],
}

export const DEFAULT_PATIENT_GROUPS: PatientGroupsData = {
  overview: {
    em_dia: 0,
    precisa_retorno: 0,
    desassistidos: 0,
  },
  groups: {
    precisa_retorno: [],
    nao_responderam: [],
    precisam_de_acao: [],
    precisam_de_consulta: [],
    followup_window: [],
    alta_demanda: [],
  },
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as any
    if (e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 20) return true
    if (e.isAbort === true) return true
    if (
      typeof e.message === 'string' &&
      (e.message.includes('signal is aborted') ||
        e.message.includes('The user aborted a request') ||
        e.message.includes('Fetch is aborted'))
    ) {
      return true
    }
    if (e.originalError && isAbortError(e.originalError)) return true
    if (e.cause && isAbortError(e.cause)) return true
  }
  return false
}

export async function getCareDashboard(signal?: AbortSignal): Promise<CareDashboardData> {
  if (signal?.aborted) {
    return DEFAULT_CARE_DASHBOARD
  }

  const token = pb.authStore.token || ''
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = token
  }

  // Timeout defensivo de 8s para não travar a UI se a rede ou backend atrasar
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let effectiveSignal = signal

  if (!effectiveSignal) {
    const internalController = new AbortController()
    timeoutId = setTimeout(() => internalController.abort(), 8000)
    effectiveSignal = internalController.signal
  }

  try {
    return await pb.send<CareDashboardData>('/backend/v1/crm-care/dashboard', {
      method: 'GET',
      headers,
      signal: effectiveSignal,
      requestKey: null,
    })
  } catch (err: any) {
    // Cancelamento benigno (StrictMode, troca de rota, tab/filtro ou timeout defensivo)
    // ou erro 401/403/offline: retorna fallback limpo sem jogar exceção na UI
    if (isAbortError(err) || effectiveSignal?.aborted || err?.status === 401) {
      return DEFAULT_CARE_DASHBOARD
    }
    console.debug(
      '[crm-care/dashboard] Erro na requisição, utilizando fallback gracioso:',
      err?.message || err,
    )
    return DEFAULT_CARE_DASHBOARD
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export async function getPatientGroups(
  filters?: PatientGroupFilters,
  signal?: AbortSignal,
): Promise<PatientGroupsData> {
  if (signal?.aborted) {
    return DEFAULT_PATIENT_GROUPS
  }

  const params = new URLSearchParams()
  if (filters?.period_days) params.set('period_days', String(filters.period_days))
  if (filters?.care_status) params.set('care_status', filters.care_status)
  if (filters?.stage) params.set('stage', filters.stage)
  if (filters?.min_priority !== undefined && filters.min_priority > 0) {
    params.set('min_priority', String(filters.min_priority))
  }
  const query = params.toString()
  const path = query
    ? `/backend/v1/crm-care/patient-groups?${query}`
    : '/backend/v1/crm-care/patient-groups'

  try {
    return await pb.send<PatientGroupsData>(path, {
      method: 'GET',
      signal,
      requestKey: null,
    })
  } catch (err: any) {
    if (isAbortError(err) || signal?.aborted) {
      return DEFAULT_PATIENT_GROUPS
    }
    console.debug(
      '[crm-care/patient-groups] Erro na requisição, utilizando fallback gracioso:',
      err?.message || err,
    )
    return DEFAULT_PATIENT_GROUPS
  }
}
