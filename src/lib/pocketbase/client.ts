import PocketBase, { ClientResponseError } from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

// Blindagem do connectErrorHandler no serviço Realtime
// Em caso de falha de conexão SSE (offline, proxy reverso, timeout), evita que a rejeição derrube a UI
if (pb.realtime) {
  const realtimeService = pb.realtime as any
  const originalConnectErrorHandler = realtimeService.connectErrorHandler?.bind(realtimeService)

  if (typeof originalConnectErrorHandler === 'function') {
    realtimeService.connectErrorHandler = function (err: any) {
      console.warn(
        '[Realtime] Conexão SSE falhou temporariamente, operando offline:',
        err?.message || err,
      )
      return originalConnectErrorHandler(err)
    }
  }
}

// Guard global contra unhandledrejection originado do realtime
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const isRealtimeError =
      (reason instanceof ClientResponseError && (reason.status === 0 || !reason.status)) ||
      (reason instanceof Error &&
        (reason.message?.includes('realtime') ||
          reason.message?.includes('EventSource') ||
          reason.stack?.includes('RealtimeService') ||
          reason.stack?.includes('connectErrorHandler')))

    if (isRealtimeError) {
      console.warn(
        '[Realtime] Conexão SSE falhou temporariamente, operando offline:',
        reason?.message || reason,
      )
      event.preventDefault()
    }
  })
}

export default pb
