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
 * Identifica erros de rede, status 0 (conexão recusada / offline / broken pipe) ou abortos de requisição.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
  }

  if (typeof error === 'object') {
    const err = error as any
    if (err.status === 0 || err.statusCode === 0) return true
    if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
      return true
    }

    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('broken pipe') ||
      msg.includes('connection refused') ||
      msg.includes('econnrefused') ||
      msg.includes('signal is aborted') ||
      msg.includes('aborterror') ||
      msg.includes('autocancelled') ||
      msg.includes('user aborted')
    ) {
      return true
    }

    if (err.originalError && isNetworkError(err.originalError)) return true
    if (err.cause && isNetworkError(err.cause)) return true
  }

  return false
}

/**
 * Identifica erros de HTTP 429 (Too Many Requests / Rate Limit).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }

  if (typeof error === 'object') {
    const err = error as any
    if (err.status === 429 || err.statusCode === 429) return true
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }

  return false
}

/**
 * Faz parse seguro do cabeçalho Retry-After ou calcula delay em ms com clamping min 500ms e max 30000ms.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  if (error && typeof error === 'object') {
    const err = error as any
    // Tenta ler dos headers da response PocketBase ou fetch
    const headers = err.response?.headers || err.headers
    let headerVal: string | null = null

    if (headers) {
      if (typeof headers.get === 'function') {
        headerVal = headers.get('retry-after') || headers.get('Retry-After')
      } else if (typeof headers === 'object') {
        headerVal = headers['retry-after'] || headers['Retry-After'] || null
      }
    }

    if (headerVal) {
      const parsedSeconds = parseFloat(headerVal)
      if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
        const ms = Math.round(parsedSeconds * 1000)
        return Math.max(MIN_MS, Math.min(ms, MAX_MS))
      }
    }
  }

  return Math.max(MIN_MS, Math.min(fallbackMs, MAX_MS))
}
