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
    let unsubPromise: Promise<() => Promise<void>> | undefined
    try {
      unsubPromise = pb.collection('quick_replies').subscribe('*', () => {
        reload()
      })
      unsubPromise?.catch((err) => {
        console.warn('[useQuickReplies] Falha ao assinar quick_replies:', err?.message || err)
      })
    } catch (err: any) {
      console.warn('[useQuickReplies] Exceção ao assinar quick_replies:', err?.message || err)
    }
    return () => {
      if (unsubPromise) {
        unsubPromise
          .then((unsub) => {
            if (typeof unsub === 'function') return unsub()
          })
          .catch(() => {})
      }
    }
  }, [accountId, reload])

  return { replies, loading, reload }
}
