import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Detecta se o erro decorre de falha de conexão, aborto ou rede inacessível.
 * ATENÇÃO: Esta exportação é guardada por teste e necessária para evitar MISSING_EXPORT.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof Error) {
    const msg = (error.message || '').toLowerCase()
    const name = (error.name || '').toLowerCase()
    if (
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||
      msg.includes('abort') ||
      name.includes('aborterror') ||
      name.includes('networkerror')
    ) {
      return true
    }
  }
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, any>
    if (errObj.isAbort || errObj.name === 'AbortError') return true
    if (errObj.status === 0 || errObj.status === '0') return true
    if (errObj.originalError && isNetworkError(errObj.originalError)) return true
  }
  return false
}

/**
 * Detecta erro HTTP 429 (Too Many Requests / Rate Limit).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const anyErr = error as Record<string, any>
    if (anyErr.status === 429 || anyErr.statusCode === 429) return true
    if (anyErr.response && (anyErr.response.status === 429 || anyErr.response.statusCode === 429)) {
      return true
    }
  }
  if (error instanceof Error) {
    const msg = error.message || ''
    if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) {
      return true
    }
  }
  return false
}

/**
 * Extrai o tempo de espera (ms) do header retry-after ou valor padrão seguro.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const anyErr = error as Record<string, any>
  const headers = anyErr.response?.headers || anyErr.headers
  if (!headers) return fallbackMs

  let val: unknown
  if (typeof headers.get === 'function') {
    val = headers.get('retry-after')
  } else if (typeof headers === 'object') {
    val = headers['retry-after'] || headers['Retry-After']
  }

  if (typeof val === 'string' || typeof val === 'number') {
    const parsedSec = Number(val)
    if (!isNaN(parsedSec) && parsedSec > 0) {
      return Math.min(parsedSec * 1000, 30000)
    }
  }
  return fallbackMs
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
