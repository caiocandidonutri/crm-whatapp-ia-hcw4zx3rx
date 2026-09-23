import { useState, useEffect, useCallback } from 'react'
import { getQuickReplies } from '@/services/quick_replies'
import type { QuickReply } from '@/types/models'
import { useRealtime } from '@/hooks/use-realtime'

export function useQuickReplies(accountId?: string) {
  const [replies, setReplies] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!accountId) {
      setReplies([])
      return
    }
    setLoading(true)
    try {
      const data = await getQuickReplies(accountId)
      setReplies(data)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    reload()
  }, [reload])

  // Realtime subscription com backoff resiliente
  useRealtime(
    'quick_replies',
    () => {
      reload()
    },
    !!accountId,
  )

  return { replies, loading, reload }
}
