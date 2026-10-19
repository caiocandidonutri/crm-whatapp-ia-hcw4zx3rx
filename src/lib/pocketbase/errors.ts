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
 * Identifica erros de rede, timeout, abort, 502/503/504 Bad Gateway / Gateway Timeout
 * ou indisponibilidade de conexão.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof error !== 'object') return false

  const err = error as any
  const status = err.status ?? err.statusCode ?? err.response?.status
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return true
  }

  const name = String(err.name || '')
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'CanceledError') {
    return true
  }

  const msg = String(err.message || '').toLowerCase()
  if (
    msg.includes('networkerror') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('bad gateway') ||
    msg.includes('502') ||
    msg.includes('gateway timeout') ||
    msg.includes('504') ||
    msg.includes('service unavailable') ||
    msg.includes('503')
  ) {
    return true
  }

  if (err.originalError && isNetworkError(err.originalError)) return true
  if (err.cause && isNetworkError(err.cause)) return true

  return false
}

/**
 * Identifica erros 429 de Rate Limit.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error !== 'object') return false

  const err = error as any
  const status = err.status ?? err.statusCode ?? err.response?.status
  if (status === 429) return true

  const msg = String(err.message || '').toLowerCase()
  return msg.includes('429') || msg.includes('too many requests')
}

/**
 * Extrai o tempo de espera em ms a partir do cabeçalho retry-after.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const err = error as any
  const headers = err.response?.headers || err.headers
  let headerVal: string | null = null

  if (headers) {
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after')
    } else if (headers['retry-after']) {
      headerVal = headers['retry-after']
    } else if (headers['Retry-After']) {
      headerVal = headers['Retry-After']
    }
  }

  if (headerVal) {
    const sec = parseInt(headerVal, 10)
    if (!isNaN(sec) && sec > 0) {
      return sec * 1000
    }
  }

  return fallbackMs
}
