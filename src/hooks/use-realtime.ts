import { useEffect, useRef, useState } from 'react'
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
 *
 * Robustez extra (P0.2):
 *  - Antes de subscrever, garante que o token de auth está fresco via
 *    `pb.collection('users').authRefresh()`. Se o token estiver expirado,
 *    o PocketBase rejeita a conexão SSE com `400 Invalid realtime client`.
 *  - Se a subscrição falhar (rede, 400, etc.), retenta com backoff
 *    exponencial (1s → 2s → 4s → 8s → max 30s), até 5 tentativas.
 *  - Expõe `connectionStatus` global via `useRealtimeStatus()` para que a
 *    UI mostre um indicador sutil de "desconectado" após esgotar retries.
 *
 * Nota: o SDK do PocketBase já reconecta o EventSource automaticamente,
 * mas ele não refaz o `authRefresh` nem retenta a própria chamada
 * `subscribe()` quando ela rejeita (token inválido). Por isso tratamos
 * isso aqui manualmente.
 */

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

// Estado global compartilhado entre todos os useRealtime ativos.
// Apenas o status mais pessimista é exibido.
type GlobalState = {
  status: RealtimeConnectionStatus
  listeners: Set<(s: RealtimeConnectionStatus) => void>
}
const globalState: GlobalState = {
  status: 'connecting',
  listeners: new Set(),
}

function setGlobalStatus(status: RealtimeConnectionStatus) {
  if (globalState.status === status) return
  globalState.status = status
  for (const l of globalState.listeners) l(status)
}

/**
 * Hook que expõe o status agregado da conexão realtime. Usado por banners/
 * indicadores sutis de "desconectado". Re-renderiza apenas quando muda.
 */
export function useRealtimeStatus(): RealtimeConnectionStatus {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(globalState.status)
  useEffect(() => {
    globalState.listeners.add(setStatus)
    setStatus(globalState.status)
    return () => {
      globalState.listeners.delete(setStatus)
    }
  }, [])
  return status
}

const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000

function backoffDelay(attempt: number): number {
  const d = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  // pequeno jitter para evitar thundering herd
  return d + Math.random() * 250
}

/**
 * Dedupe global do `authRefresh`: vários componentes subscrevem realtime ao
 * mesmo tempo (conversations, messages, tasks, notifications, ...). Sem
 * dedupe, cada um chamaria `authRefresh()` concorrentemente e estouraria o
 * rate limit do PocketBase — irônico dado que o objetivo é justamente evitar
 * 429. Aqui mantemos uma única promise em andamento; todas as chamadas
 * aguardam o mesmo refresh.
 */
let refreshInflight: Promise<void> | null = null
let lastRefreshAt = 0
const REFRESH_MIN_INTERVAL_MS = 5000 // não refresca mais que 1x a cada 5s

/** Tenta renovar o token de auth. Ignora se não há sessão. Dedupe chamadas. */
async function ensureFreshToken(): Promise<void> {
  if (!pb.authStore.isValid) return
  // Throttle: se um refresh acabou de acontecer, pula (o token ainda é fresco).
  if (Date.now() - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return
  if (refreshInflight) return refreshInflight

  refreshInflight = (async () => {
    try {
      await pb.collection('users').authRefresh()
      lastRefreshAt = Date.now()
    } catch {
      // Se o refresh falha (token definitivamente inválido), o use-auth
      // cuidará de limpar a sessão. Mantemos silencioso: o retry da
      // subscrição ainda tentará com o token atual.
    } finally {
      refreshInflight = null
    }
  })()
  return refreshInflight
}

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
    let attempt = 0

    const subscribeWithRetry = async () => {
      if (cancelled) return
      setGlobalStatus(attempt === 0 ? 'connecting' : 'reconnecting')

      try {
        // Garante token fresco antes de abrir a conexão. O PocketBase
        // realtime exige um client autenticado; se o token expirou, o
        // POST de subscription é rejeitado com 400 Invalid realtime client.
        await ensureFreshToken()
        if (cancelled) return

        const fn = await pb.collection<TRecord>(collectionName).subscribe('*', (e) => {
          callbackRef.current(e)
        })

        if (cancelled) {
          fn().catch(() => {})
          return
        }

        unsubscribeFn = fn
        attempt = 0
        setGlobalStatus('connected')
      } catch (err) {
        if (cancelled) return
        attempt += 1
        if (attempt > MAX_RETRIES) {
          setGlobalStatus('disconnected')
          return
        }
        setGlobalStatus('reconnecting')
        retryTimer = setTimeout(subscribeWithRetry, backoffDelay(attempt - 1))
      }
    }

    subscribeWithRetry()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
    }
  }, [collectionName, enabled])
}

export default useRealtime
