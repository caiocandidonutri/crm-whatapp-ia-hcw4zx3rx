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
 * Detecta se o erro decorre de falha de rede, conexão abortada, timeout ou status 0 do PocketBase.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    if ((error as { status: unknown }).status === 0) return true
  }

  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)

  const msg = rawMsg.toLowerCase()

  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted') ||
    msg.includes('aborted') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('timeout')
  ) {
    return true
  }

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true
  }

  return false
}

/**
 * Detecta se o erro é HTTP 429 (Too Many Requests / Rate Limit).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    if ((error as { status: unknown }).status === 429) return true
  }

  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)

  const msg = rawMsg.toLowerCase()
  if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
    return true
  }

  return false
}

/**
 * Extrai o cabeçalho retry-after (em segundos numéricos ou data HTTP) e converte em milissegundos.
 * Aplica clamping com limite mínimo de 500ms e máximo de 30000ms.
 * Caso o cabeçalho não esteja presente ou seja inválido, retorna fallbackMs.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  let headerVal: string | number | null | undefined = null

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, any>
    const resp = errObj.response

    if (resp && typeof resp === 'object') {
      const headers = resp.headers
      if (headers) {
        if (typeof headers.get === 'function') {
          headerVal = headers.get('retry-after') || headers.get('Retry-After')
        } else if (typeof headers === 'object') {
          headerVal =
            headers['retry-after'] ??
            headers['Retry-After'] ??
            headers['retryAfter'] ??
            headers['RetryAfter']
        }
      }
    }

    if (headerVal == null && errObj.headers) {
      const headers = errObj.headers
      if (typeof headers.get === 'function') {
        headerVal = headers.get('retry-after') || headers.get('Retry-After')
      } else if (typeof headers === 'object') {
        headerVal =
          headers['retry-after'] ??
          headers['Retry-After'] ??
          headers['retryAfter'] ??
          headers['RetryAfter']
      }
    }
  }

  if (headerVal == null || headerVal === '') {
    return fallbackMs
  }

  let delayMs: number | null = null

  const numSeconds = Number(headerVal)
  if (!Number.isNaN(numSeconds) && numSeconds >= 0) {
    delayMs = Math.round(numSeconds * 1000)
  } else if (typeof headerVal === 'string') {
    const parsedDate = Date.parse(headerVal)
    if (!Number.isNaN(parsedDate)) {
      const diff = parsedDate - Date.now()
      delayMs = diff > 0 ? diff : 0
    }
  }

  if (delayMs === null) {
    return fallbackMs
  }

  return Math.min(Math.max(delayMs, MIN_MS), MAX_MS)
}
