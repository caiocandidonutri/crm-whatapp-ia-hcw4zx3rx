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
 *
 * Robustez adicional (fix do erro 400 "Invalid realtime client" e do
 * spam de POST /api/realtime nos logs):
 *
 *  - **Retry com backoff exponencial.** Antes o `.catch(() => {})`
 *    engolia qualquer rejeição do `subscribe` (400/401/rede) e o hook
 *    ficava mudo: novas mensagens não chegavam até o usuário recarregar
 *    a página. Agora, falha → retenta com delay crescente (1s, 2s, 4s,
 *    8s, … capado em 30s), sem ficar spammando o backend.
 *
 *  - **Refresh de token em 401/403.** O client realtime do PocketBase
 *    envia o token do `authStore` no header do POST /api/realtime.
 *    Token expirado/vazio → 400/401. Em erro de auth, fazemos
 *    `authRefresh()` antes de retentar, para reconectar com um token
 *    válido. Se o refresh também falhar (sessão morta), o backoff
 *    normal assume.
 *
 *  - **Reseta o backoff após sucesso.** Conexão estável zera o contador
 *    de tentativas.
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
    let attempt = 0

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const trySubscribe = async () => {
      if (cancelled) return

      try {
        const fn = await pb.collection<TRecord>(collectionName).subscribe('*', (e) => {
          callbackRef.current(e)
        })
        if (cancelled) {
          // O componente desmontou enquanto a promise resolvia —
          // limpa a subscription que acabou de ser criada.
          fn().catch(() => {})
          return
        }
        unsubscribeFn = fn
        attempt = 0 // sucesso: reseta o backoff
      } catch (err: any) {
        if (cancelled) return

        const status = err?.status || err?.response?.status || 0

        // 401/403: token pode ter expirado. Tenta refresh e retenta
        // (o refresh conta como a "ação" desta tentativa — não pulamos
        // o backoff, mas o próximo ciclo já usa token novo).
        if (status === 401 || status === 403) {
          try {
            if (pb.authStore.isValid) {
              await pb.collection('users').authRefresh()
            }
          } catch {
            // refresh falhou (ex.: sessão morta) — o backoff abaixo
            // limita o ritmo de retentativas para não lotar os logs.
          }
        }

        // Backoff exponencial: 1s, 2s, 4s, 8s, … capado em 30s.
        attempt++
        const delay = Math.min(30000, 1000 * 2 ** (attempt - 1))
        clearRetry()
        retryTimer = setTimeout(() => {
          retryTimer = null
          trySubscribe()
        }, delay)
      }
    }

    trySubscribe()

    return () => {
      cancelled = true
      clearRetry()
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
        unsubscribeFn = undefined
      }
    }
  }, [collectionName, enabled])
}

export default useRealtime
