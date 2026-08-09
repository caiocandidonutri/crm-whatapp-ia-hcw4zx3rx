import pb from '@/lib/pocketbase/client'
import type { CareFollowupRule } from '@/types/models'

export async function getFollowupRules(accountId: string): Promise<CareFollowupRule[]> {
  return pb.collection('care_followup_rules').getFullList({
    filter: `account_id="${accountId}"`,
    sort: 'created',
  })
}

export async function createFollowupRule(
  accountId: string,
  data: { name: string; followup_days: number; reminder_text?: string },
): Promise<CareFollowupRule> {
  return pb.collection('care_followup_rules').create({ ...data, account_id: accountId })
}

export async function updateFollowupRule(
  id: string,
  data: { name?: string; followup_days?: number; reminder_text?: string },
): Promise<CareFollowupRule> {
  return pb.collection('care_followup_rules').update(id, data)
}

export async function deleteFollowupRule(id: string): Promise<void> {
  await pb.collection('care_followup_rules').delete(id)
}
