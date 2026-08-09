import { useState, useEffect, useCallback } from 'react'
import { getMessageTemplates } from '@/services/message_templates'
import { useRealtime } from '@/hooks/use-realtime'
import type { MessageTemplate } from '@/types/models'

export function useMessageTemplates(accountId?: string) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!accountId) {
      setTemplates([])
      setLoading(false)
      return
    }
    try {
      setTemplates(await getMessageTemplates(accountId))
    } catch {
      // ignore
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  useRealtime('message_templates', () => load(), !!accountId)

  return { templates, loading, reload: load }
}
