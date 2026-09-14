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
  onReconnect?: () => void,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let unsubscribeReconnect: (() => Promise<void>) | undefined
    let cancelled = false
    let isInitialConnect = true

    pb.collection<TRecord>(collectionName)
      .subscribe('*', (e) => {
        callbackRef.current(e)
      })
      .then((fn) => {
        if (cancelled) {
          fn().catch(() => {})
        } else {
          unsubscribeFn = fn
        }
      })
      .catch(() => {})

    if (onReconnectRef.current) {
      pb.realtime
        .subscribe('PB_CONNECT', () => {
          if (cancelled) return
          if (isInitialConnect) {
            isInitialConnect = false
            return
          }
          onReconnectRef.current?.()
        })
        .then((fn) => {
          if (cancelled) {
            fn().catch(() => {})
          } else {
            unsubscribeReconnect = fn
          }
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
      if (unsubscribeReconnect) {
        unsubscribeReconnect().catch(() => {})
      }
    }
  }, [collectionName, enabled])
}

export default useRealtime
