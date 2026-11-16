import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Detecta erros de rede (fetch falhou, abortado, offline, timeout).
 * Usado para mostrar mensagens de "sem conexão" em vez de erros genéricos.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as any)?.message ?? '')
  if (typeof msg !== 'string' || !msg) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('aborterror') ||
    lower.includes('load failed') ||
    lower.includes('fetch failed') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  )
}

/**
 * Detecta erros de limite de requisições (HTTP 429 / "Too Many Requests").
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = (error as any)?.status ?? (error as any)?.response?.status ?? (error as any)?.code
  if (status === 429) return true
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as any)?.message ?? '')
  if (
    typeof msg === 'string' &&
    /(^|[^0-9])429([^0-9]|$)|too many requests|rate ?limit/i.test(msg)
  ) {
    return true
  }
  return false
}

/**
 * Extrai o header Retry-After (em segundos) e devolve o delay em ms.
 * Faz clamp entre 500ms e 30000ms; usa `fallbackMs` (default 1000ms)
 * quando o header não existe ou não é numérico.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  let raw: unknown
  if (error && typeof error === 'object') {
    const headers = (error as any)?.response?.headers
    if (headers && typeof headers.get === 'function') {
      try {
        raw = headers.get('retry-after')
      } catch (_) {
        raw = undefined
      }
    } else if (headers && typeof headers === 'object') {
      raw = (headers as Record<string, unknown>)['retry-after']
    }
  }
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  const ms = Number.isFinite(parsed) ? parsed * 1000 : fallbackMs
  return Math.min(30000, Math.max(500, ms))
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
