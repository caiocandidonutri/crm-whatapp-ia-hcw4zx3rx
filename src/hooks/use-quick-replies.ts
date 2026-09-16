import { useState, useEffect, useCallback } from 'react'
import { getQuickReplies } from '@/services/quick_replies'
import type { QuickReply } from '@/types/models'
import pb from '@/lib/pocketbase/client'

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

  // Realtime subscription
  useEffect(() => {
    if (!accountId) return
    const unsubscribe = pb.collection('quick_replies').subscribe('*', () => {
      reload()
    })
    return () => {
      unsubscribe.then((unsub) => unsub()).catch(() => {})
    }
  }, [accountId, reload])

  return { replies, loading, reload }
}
