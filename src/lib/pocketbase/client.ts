import PocketBase, { ClientResponseError } from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

/**
 * Blindagem global de erros benignos de rede (AbortError, autocancelações e quedas transitórias de SSE).
 * Evita que o React unhandledrejection derrube a árvore React ou dispare barreiras de erro globais.
 */
if (typeof window !== 'undefined') {
  const isBenignNetworkError = (error: unknown): boolean => {
    if (!error) return false
    if (typeof error === 'object') {
      const e = error as any
      // AbortError e variantes de cancelamento do Fetch / DOMException
      if (e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 20) return true
      if (e.isAbort === true) return true
      if (
        typeof e.message === 'string' &&
        (e.message.includes('signal is aborted') ||
          e.message.includes('The user aborted a request') ||
          e.message.includes('Fetch is aborted') ||
          e.message.includes('autocancelled'))
      ) {
        return true
      }
      // PocketBase ClientResponseError cancelado (status 0 ou isAbort)
      if (e instanceof ClientResponseError) {
        if (e.isAbort || e.status === 0) return true
      }
      if (e.originalError && isBenignNetworkError(e.originalError)) return true
      if (e.cause && isBenignNetworkError(e.cause)) return true
    }
    return false
  }

  window.addEventListener('unhandledrejection', (event) => {
    if (isBenignNetworkError(event.reason)) {
      event.preventDefault()
      console.debug(
        '[PocketBase] Requisição cancelada ou abortada de forma benigna:',
        event.reason?.message || event.reason,
      )
    }
  })
}

export default pb
