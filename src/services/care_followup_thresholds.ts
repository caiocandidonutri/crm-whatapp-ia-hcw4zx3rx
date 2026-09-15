import pb from '@/lib/pocketbase/client'
import type { CareFollowupThreshold } from '@/types/models'

export type FollowupCategory = 'nao_respondeu' | 'precisa_atencao' | 'perdido'

export const FOLLOWUP_CATEGORY_META: {
  id: FollowupCategory
  label: string
  description: string
}[] = [
  {
    id: 'nao_respondeu',
    label: 'Não respondeu',
    description: 'Paciente sem resposta após este número de dias.',
  },
  {
    id: 'precisa_atencao',
    label: 'Precisa de atenção',
    description: 'Paciente sem resposta prolongada — necessita atenção.',
  },
  {
    id: 'perdido',
    label: 'Perdido',
    description: 'Paciente considerado perdido/sem contato após este período.',
  },
]

export async function getFollowupThresholds(accountId: string): Promise<CareFollowupThreshold[]> {
  return pb.collection('care_followup_thresholds').getFullList({
    filter: `account_id="${accountId}"`,
    sort: 'category',
    requestKey: null,
  })
}

export async function upsertFollowupThreshold(
  accountId: string,
  data: { category: FollowupCategory; days: number; enabled?: boolean },
): Promise<CareFollowupThreshold> {
  const existing = await getFollowupThresholds(accountId)
  const match = existing.find((t) => t.category === data.category)
  if (match) {
    return pb.collection('care_followup_thresholds').update(match.id, {
      days: data.days,
      enabled: data.enabled ?? true,
    })
  }
  return pb.collection('care_followup_thresholds').create({
    account_id: accountId,
    category: data.category,
    days: data.days,
    enabled: data.enabled ?? true,
  })
}

export async function updateFollowupThreshold(
  id: string,
  data: { days?: number; enabled?: boolean },
): Promise<CareFollowupThreshold> {
  return pb.collection('care_followup_thresholds').update(id, data)
}

export async function deleteFollowupThreshold(id: string): Promise<void> {
  await pb.collection('care_followup_thresholds').delete(id)
}
