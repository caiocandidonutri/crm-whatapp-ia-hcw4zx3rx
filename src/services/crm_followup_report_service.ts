import { pb } from '@/lib/pocketbase/client'

export interface FollowupRuleStat {
  id: string
  name: string
  followup_days: number
  displayName: string
  created_pending: number
  recovered_count: number
  recovery_rate: number
}

export interface RecoveredPatient {
  contact_id: string
  name: string
  rule_name: string
  rule_id: string
  phone: string
  recovered_at: string
  reason: string
}

export interface FollowupReportResponse {
  days: number
  summary: {
    total_recovered: number
    total_pending: number
    recovery_rate: number
  }
  rules: FollowupRuleStat[]
  recent_recovered: RecoveredPatient[]
}

export async function fetchFollowupReport(days: 7 | 30 = 30): Promise<FollowupReportResponse> {
  const token = pb.authStore.token
  const res = await fetch(`/backend/v1/crm/followup-report?days=${days}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error('Falha ao carregar relatório de follow-ups')
  }

  return res.json()
}
