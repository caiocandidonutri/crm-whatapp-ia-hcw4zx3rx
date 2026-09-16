import pb from '@/lib/pocketbase/client'
import type { QuickReply } from '@/types/models'

export async function getQuickReplies(accountId: string): Promise<QuickReply[]> {
  if (!accountId) return []
  try {
    const records = await pb.collection('quick_replies').getFullList<QuickReply>({
      filter: `account_id="${accountId}"`,
      sort: 'sort_order,created',
      requestKey: null,
    })
    return records
  } catch (err) {
    console.error('Erro ao buscar respostas rápidas:', err)
    return []
  }
}

export async function createQuickReply(
  accountId: string,
  data: {
    title: string
    shortcut?: string
    body: string
    category?: string
    sort_order?: number
  },
): Promise<QuickReply> {
  return await pb.collection('quick_replies').create<QuickReply>({
    account_id: accountId,
    title: data.title.trim(),
    shortcut: data.shortcut?.trim() || '',
    body: data.body.trim(),
    category: data.category?.trim() || 'geral',
    sort_order: data.sort_order ?? 0,
  })
}

export async function updateQuickReply(
  id: string,
  data: Partial<{
    title: string
    shortcut: string
    body: string
    category: string
    sort_order: number
  }>,
): Promise<QuickReply> {
  return await pb.collection('quick_replies').update<QuickReply>(id, data)
}

export async function deleteQuickReply(id: string): Promise<boolean> {
  return await pb.collection('quick_replies').delete(id)
}
