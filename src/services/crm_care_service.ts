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
