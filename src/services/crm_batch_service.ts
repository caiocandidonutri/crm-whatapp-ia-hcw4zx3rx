import pb from '@/lib/pocketbase/client'

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
  return pb.send<BatchActionResult>('/backend/v1/crm/batch-action', {
    method: 'POST',
    body: params,
  })
}
