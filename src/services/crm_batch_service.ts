import { pb } from '@/lib/pocketbase/client'

export interface BatchActionParams {
  contact_ids: string[]
  action_type: 'stage' | 'care_status' | 'archive' | 'unarchive'
  target_value?: string
}

export interface BatchActionResult {
  success: boolean
  action: string
  updated_count: number
  errors_count: number
}

export async function executeCrmBatchAction(params: BatchActionParams): Promise<BatchActionResult> {
  const token = pb.authStore.token
  const res = await fetch('/backend/v1/crm/batch-action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.error || 'Falha ao executar ação em lote')
  }

  return res.json()
}
