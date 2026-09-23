import { useEffect, useRef } from 'react'
import type { RecordModel, RecordSubscription } from 'pocketbase'

import pb from '@/lib/pocketbase/client'

/**
 * Hook for real-time subscriptions to a PocketBase collection.
 * ALWAYS use this hook instead of subscribing inline.
 * Uses the per-listener UnsubscribeFunc so multiple components
 * can safely subscribe to the same collection without conflicts.
 *
 * Generic over the record type: pass your collection's interface as
 * `useRealtime<MyRecord>(...)` to get a typed subscription payload
 * instead of `unknown`.
 */
export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 2000
    let consecutiveFailures = 0
    const MAX_CONSECUTIVE_FAILURES = 5

    const subscribeWithBackoff = () => {
      if (cancelled) return

      pb.collection<TRecord>(collectionName)
        .subscribe('*', (e) => {
          if (cancelled) return
          callbackRef.current(e)
        })
        .then((fn) => {
          if (cancelled) {
            fn().catch(() => {})
          } else {
            unsubscribeFn = fn
            consecutiveFailures = 0
            retryDelay = 2000
          }
        })
        .catch((err: any) => {
          consecutiveFailures += 1
          // Loga apenas em modo debug/silencioso sem overlay de erro
          if (import.meta.env.DEV) {
            console.debug(
              `[useRealtime] Assinatura em '${collectionName}' indisponível (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
              err?.message || err,
            )
          }

          if (cancelled) return

          // Se atingiu o limite de tentativas, desiste de reconectar em loop
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            if (import.meta.env.DEV) {
              console.debug(
                `[useRealtime] Realtime indisponível para '${collectionName}'. Operando via carregamento inicial e polling leve.`,
              )
            }
            return
          }

          // Backoff exponencial: 2s, 4s, 8s, 16s... até 60s
          const nextDelay = Math.min(retryDelay * 2, 60000)
          retryTimer = setTimeout(() => {
            retryDelay = nextDelay
            subscribeWithBackoff()
          }, retryDelay)
        })
    }

    subscribeWithBackoff()

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
    }
  }, [collectionName, enabled])
}

export default useRealtime
