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

export async function getCareDashboard(): Promise<CareDashboardData> {
  return pb.send('/backend/v1/crm-care/dashboard', { method: 'GET' })
}

export async function getPatientGroups(): Promise<PatientGroupsData> {
  return pb.send('/backend/v1/crm-care/patient-groups', { method: 'GET' })
}
