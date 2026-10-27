import pb from '@/lib/pocketbase/client'

export interface RetroativoResult {
  success: boolean
  total_contacts_processed: number
  counts_before: Record<string, number>
  counts_after: Record<string, number>
  conversations_reset_count?: number
  resolved_obsolete_tasks_count: number
}

export interface RollbackResult {
  message: string
  reason: string
  total_snapshots: number
  restored_count: number
  skipped_count: number
  errors_count: number
}

/**
 * Dispara a execução retroativa de care_state determinístico com snapshot "plataforma-limpa".
 */
export async function runCareStateRetroativo(): Promise<RetroativoResult> {
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
  const token = pb.authStore.token || ''

  const res = await fetch(`${baseUrl}/backend/v1/crm/care-state/reconcile-retroativo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CRM-Token': 'crm_agenda_token_dr_caio_2026',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Erro ao executar rotina retroativa (${res.status}): ${errText}`)
  }

  return res.json()
}

/**
 * Reverte as alterações registradas no baseline_snapshots (motivo plataforma-limpa ou custom).
 */
export async function runBaselineRollback(
  reason: string = 'plataforma-limpa',
): Promise<RollbackResult> {
  const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
  const token = pb.authStore.token || ''

  const res = await fetch(`${baseUrl}/backend/v1/crm/baseline-rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CRM-Token': 'crm_agenda_token_dr_caio_2026',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Erro ao executar rollback (${res.status}): ${errText}`)
  }

  return res.json()
}
