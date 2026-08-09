import pb from '@/lib/pocketbase/client'

export async function searchMessageContent(
  instanceName: string,
  accountId: string,
  query: string,
  limit: number = 100,
): Promise<{ jids: Set<string>; previewByJid: Map<string, string> }> {
  if (!query.trim() || query.trim().length < 2) {
    return { jids: new Set(), previewByJid: new Map() }
  }
  const safeQuery = query.replace(/['"\\]/g, ' ').trim()
  if (!safeQuery) return { jids: new Set(), previewByJid: new Map() }
  try {
    const records = await pb.collection('whatsapp_messages').getList(1, limit, {
      filter: `account_id = "${accountId}" && instance_name = "${instanceName}" && content ~ "${safeQuery}"`,
      sort: '-timestamp',
      fields: 'id,remote_jid,content',
    })
    const jids = new Set<string>()
    const previewByJid = new Map<string, string>()
    for (const r of records.items) {
      const jid = (r as any).remote_jid as string
      if (jid && !jids.has(jid)) {
        jids.add(jid)
        const content = ((r as any).content as string) || ''
        previewByJid.set(jid, content.substring(0, 80))
      }
    }
    return { jids, previewByJid }
  } catch {
    return { jids: new Set(), previewByJid: new Map() }
  }
}
