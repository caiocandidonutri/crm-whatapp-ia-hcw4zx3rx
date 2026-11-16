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

const NETWORK_MESSAGE_PATTERNS = [
  'failed to fetch',
  'networkerror when attempting to fetch resource',
  'network error',
  'network request failed',
  'load failed',
  'aborterror',
]

/** True para falhas de rede/timeout/abort (status 0 do PocketBase incluído). */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    const msg = (error.message || '').toLowerCase()
    return NETWORK_MESSAGE_PATTERNS.some((p) => msg.includes(p))
  }
  if (error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError'
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
    return NETWORK_MESSAGE_PATTERNS.some((p) => msg.includes(p))
  }
  return false
}

/** True para erros HTTP 429 (rate limit), cobrindo também objetos semelhantes a erro. */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) return error.status === 429
  if (typeof error === 'object') {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
    const msg =
      error instanceof Error
        ? error.message
        : String((error as { message?: unknown }).message ?? '')
    return /429|too many requests/i.test(msg)
  }
  return false
}

/**
 * Lê o header `retry-after` (segundos ou data HTTP) e devolve ms,
 * com clamp entre 500ms e 30s. Fallback para `fallbackMs` quando ausente/inválido.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  try {
    const headers = (error as { response?: { headers?: Record<string, unknown> } | null })?.response
      ?.headers
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (typeof raw === 'string' && raw.trim() !== '') {
        const seconds = Number(raw.trim())
        if (isFinite(seconds) && seconds > 0) {
          return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(seconds * 1000)))
        }
        const asDate = new Date(raw.trim()).getTime()
        if (isFinite(asDate)) {
          const delta = asDate - Date.now()
          if (delta > 0) return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(delta)))
        }
      }
    }
  } catch {
    // header malformado: usa fallback
  }
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(fallbackMs)))
}
