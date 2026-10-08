import pb from '@/lib/pocketbase/client'
import type { CareAlertSettings, CareAlert } from '@/types/models'

export type CareAlertWithContact = CareAlert

export async function getCareAlertSettings(accountId: string): Promise<CareAlertSettings | null> {
  try {
    return await pb
      .collection('care_alert_settings')
      .getFirstListItem(`account_id="${accountId}"`, {
        requestKey: null,
      })
  } catch {
    return null
  }
}

export async function saveCareAlertSettings(
  accountId: string,
  data: {
    whatsapp_alert_phone?: string
    followup_alert_enabled?: boolean
    needs_care_alert_enabled?: boolean
    confirmation_alert_enabled?: boolean
    confirmation_hours_before?: number
    reminders_enabled?: boolean
    recall_enabled?: boolean
    recall_days_inactive?: number
    recall_daily_limit?: number
    after_hours_enabled?: boolean
    survey_enabled?: boolean
    survey_q1?: string
    survey_q2?: string
    club_recall_days_inactive?: number
    budget_followup_days?: number
    renewal_alert_days_before?: number
    return_30d_rule_enabled?: boolean
  },
): Promise<CareAlertSettings> {
  const existing = await getCareAlertSettings(accountId)
  if (existing) {
    return pb.collection('care_alert_settings').update<CareAlertSettings>(existing.id, data)
  }
  return pb.collection('care_alert_settings').create<CareAlertSettings>({
    whatsapp_alert_phone: '',
    followup_alert_enabled: true,
    needs_care_alert_enabled: true,
    confirmation_alert_enabled: true,
    confirmation_hours_before: 48,
    reminders_enabled: true,
    recall_enabled: true,
    recall_days_inactive: 14,
    club_recall_days_inactive: 45,
    budget_followup_days: 7,
    renewal_alert_days_before: 15,
    return_30d_rule_enabled: true,
    recall_daily_limit: 15,
    after_hours_enabled: true,
    survey_enabled: true,
    survey_q1: 'De 0 a 10, como foi sua experiência com a gente hoje? 💚',
    survey_q2: 'Tem algo que poderíamos melhorar no seu atendimento?',
    ...data,
    account_id: accountId,
  })
}

export async function getCareAlerts(
  accountId: string,
  limit = 30,
): Promise<CareAlertWithContact[]> {
  const res = await pb.collection('care_alerts').getList(1, limit, {
    filter: `account_id="${accountId}"`,
    sort: '-created',
    expand: 'crm_contact_id',
    requestKey: null,
  })
  return res.items as CareAlertWithContact[]
}

export interface AutomationsToggleResult {
  success: boolean
  paused: boolean
  paused_at: string | null
  paused_by: string
  account_id: string
}

export async function toggleGlobalAutomations(
  paused?: boolean,
  accountId?: string,
): Promise<AutomationsToggleResult> {
  const payload: Record<string, any> = {}
  if (typeof paused === 'boolean') payload.paused = paused
  if (accountId) payload.account_id = accountId

  return await pb.send<AutomationsToggleResult>('/backend/v1/settings/automations-toggle', {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export interface AutomationAuditItem {
  id: string
  remote_jid: string
  patient_name: string
  content: string
  automation_type: string
  is_automated: boolean
  status: string
  created_at: string
  created_at_sp: string
}

export interface AutomationAuditResponse {
  items: AutomationAuditItem[]
  total: number
}

export async function getAutomationsAudit(limit = 35): Promise<AutomationAuditResponse> {
  return await pb.send<AutomationAuditResponse>('/backend/v1/settings/automations-audit', {
    method: 'GET',
    params: { limit },
  })
}
