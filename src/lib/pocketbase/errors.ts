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
 * Identifica erros de rede, cancelamento/abort e falhas de conexão com o backend.
 * Exportação obrigatória para prevenir regressões de runtime e build.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as any
    if (e.name === 'AbortError' || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
      return true
    }
    if (e.isAbort === true) return true
    if (e.status === 0 || e.statusCode === 0) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('signal is aborted') ||
      msg.includes('aborterror') ||
      msg.includes('autocancelled') ||
      msg.includes('connection refused') ||
      msg.includes('err_connection')
    ) {
      return true
    }
    if (e.originalError && isNetworkError(e.originalError)) return true
    if (e.cause && isNetworkError(e.cause)) return true
  }
  return false
}

/**
 * Detecta resposta de rate-limit (HTTP 429).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 429 || e.statusCode === 429) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
    if (e.originalError && isRateLimitError(e.originalError)) return true
  }
  return false
}

/**
 * Extrai o tempo de espera em milissegundos do cabeçalho Retry-After ou usa fallback.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const e = error as any
  const headerVal =
    e.response?.headers?.['retry-after'] ||
    e.response?.headers?.['Retry-After'] ||
    e.headers?.['retry-after'] ||
    e.headers?.['Retry-After']

  if (headerVal) {
    const parsedSec = Number(headerVal)
    if (!Number.isNaN(parsedSec) && parsedSec > 0) {
      return Math.min(Math.max(parsedSec * 1000, 500), 15000)
    }
  }
  return fallbackMs
}
