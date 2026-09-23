import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'

/**
 * Status da conexão realtime do PocketBase (SSE).
 *
 * O SDK PocketBase expõe `pb.realtime.isConnected` e o evento especial
 * `PB_CONNECT`, que é disparado toda vez que a conexão é estabelecida
 * (conexão inicial E reconexões automáticas). Não há um evento explícito
 * de "disconnect", mas o SDK reseta o clientID ao perder a conexão —
 * usamos isso para detectar a queda.
 *
 * Estados:
 *  - `connecting`    : ainda não conectou pela primeira vez
 *  - `connected`     : conexão ativa
 *  - `reconnecting`  : caiu e está tentando reconectar
 *  - `disconnected`  : sem conexão e não conseguiu reconectar
 */
export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    pb.realtime.isConnected ? 'connected' : 'connecting',
  )

  useEffect(() => {
    let cancelled = false

    // Marca como conectado sempre que o SDK dispara PB_CONNECT (conexão
    // inicial + reconexões automáticas).
    let unsubPromise: Promise<() => Promise<void>> | undefined
    try {
      unsubPromise = pb.realtime.subscribe('PB_CONNECT', () => {
        if (cancelled) return
        setStatus('connected')
      })
      unsubPromise?.catch((err) => {
        if (import.meta.env.DEV) {
          console.debug('[useRealtimeStatus] Falha ao assinar PB_CONNECT:', err?.message || err)
        }
      })
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.debug('[useRealtimeStatus] Exceção ao assinar PB_CONNECT:', err?.message || err)
      }
    }

    // Heartbeat leve: confere `isConnected` a cada 2s. Se caiu e o SDK
    // ainda está tentando reconectar, marcamos `reconnecting`; se demorar
    // demais (mais de ~10s sem reconectar), marcamos `disconnected`.
    let downSince: number | null = null
    const interval = setInterval(() => {
      if (cancelled) return
      const connected = pb.realtime.isConnected
      if (connected) {
        downSince = null
        setStatus('connected')
        return
      }
      // não está conectado
      const now = Date.now()
      if (downSince === null) downSince = now
      const elapsed = now - downSince
      if (elapsed > 10_000) {
        setStatus('disconnected')
      } else {
        setStatus('reconnecting')
      }
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
      // unsubPromise é uma Promise<UnsubscribeFunc> — resolve e chama com segurança.
      if (unsubPromise) {
        unsubPromise
          .then((fn) => {
            if (typeof fn === 'function') {
              return fn()
            }
          })
          .catch(() => {})
      }
    }
  }, [])

  return status
}
