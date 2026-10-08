import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ClientResponseError)) return {}
  const data = error.response?.data
  if (!data || typeof data !== 'object') return {}
  const errors: FieldErrors = {}
  for (const [field, detail] of Object.entries(data)) {
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof (detail as { message: unknown }).message === 'string'
    ) {
      errors[field] = (detail as { message: string }).message
    }
  }
  return errors
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}

/**
 * Detecta se um erro é tipicamente de falha de rede/conectividade
 * (offline, fetch failed, timeout, conexão recusada, status 0).
 * CRÍTICO: NÃO REMOVER OU RENOMEAR esta exportação — é consumida por múltiplos módulos.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 0 || e.statusCode === 0) return true
    if (e.name === 'NetworkError' || e.name === 'FetchError') return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('connection refused') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('net::err') ||
      msg.includes('offline')
    ) {
      return true
    }
    if (e.originalError && isNetworkError(e.originalError)) return true
    if (e.cause && isNetworkError(e.cause)) return true
  }
  return false
}
