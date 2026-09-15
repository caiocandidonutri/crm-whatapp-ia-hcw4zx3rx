import pb from '@/lib/pocketbase/client'
import type { MessageTemplate } from '@/types/models'

export type TriggerType = 'primeiro_contato' | 'reengajamento' | 'pos_consulta'

export async function getMessageTemplates(accountId: string): Promise<MessageTemplate[]> {
  return pb.collection('message_templates').getFullList({
    filter: `account_id="${accountId}"`,
    sort: 'created',
    requestKey: null,
  })
}

export async function createMessageTemplate(
  accountId: string,
  data: { name: string; trigger_type: TriggerType; content: string; created_by?: string },
): Promise<MessageTemplate> {
  return pb.collection('message_templates').create({ ...data, account_id: accountId })
}

export async function updateMessageTemplate(
  id: string,
  data: { name?: string; trigger_type?: TriggerType; content?: string },
): Promise<MessageTemplate> {
  return pb.collection('message_templates').update(id, data)
}

export async function deleteMessageTemplate(id: string): Promise<void> {
  await pb.collection('message_templates').delete(id)
}
