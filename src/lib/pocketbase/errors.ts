import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Identifica se um erro é decorrente de falha de rede, timeout, cancelamento
 * ou indisponibilidade temporária de conexão com o PocketBase (status 0).
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.isAbort) return true
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>
    if (err.status === 0 || err.status === '0') return true
    if (err.name === 'AbortError' || err.isAbort === true) return true

    const msg = typeof err.message === 'string' ? err.message : ''
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('AbortError') ||
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('ERR_CONNECTION_REFUSED') ||
      msg.includes('signal is aborted')
    ) {
      return true
    }
  }

  return false
}

/**
 * Identifica se o erro é HTTP 429 (Too Many Requests / rate limit).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>
    if (err.status === 429 || err.status === '429') return true
    const msg = typeof err.message === 'string' ? err.message : ''
    if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) {
      return true
    }
  }

  return false
}

/**
 * Extrai o tempo de espera (em milissegundos) a partir do cabeçalho retry-after
 * com clamping entre 500ms e 30000ms.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  if (typeof error === 'object' && error !== null) {
    const err = error as any
    const headers = err.response?.headers || err.headers
    let headerVal: unknown

    if (headers) {
      if (typeof headers.get === 'function') {
        headerVal = headers.get('retry-after')
      } else if (typeof headers === 'object') {
        headerVal = headers['retry-after'] || headers['Retry-After']
      }
    }

    if (headerVal !== undefined && headerVal !== null) {
      const parsedSeconds = parseFloat(String(headerVal))
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        const ms = Math.round(parsedSeconds * 1000)
        return Math.min(Math.max(ms, MIN_MS), MAX_MS)
      }
    }
  }

  return Math.min(Math.max(fallbackMs, MIN_MS), MAX_MS)
}

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
