import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Contrato das 5 exportações definido por errors.test.ts — NÃO editar/truncar.
 * Qualquer remoção daqui quebra o build (MISSING_EXPORT) e derruba a /home
 * no ErrorBoundary global, pois resilient.ts importa as 3 helpers no boot
 * do módulo (fora da cobertura do boundary interno da Home).
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (typeof error === 'object') {
    const anyErr = error as { status?: unknown; name?: unknown; message?: unknown }
    if (anyErr.name === 'AbortError') return true
    if (typeof anyErr.message === 'string') {
      const msg = anyErr.message
      if (
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('AbortError') ||
        msg.includes('signal is aborted')
      ) {
        return true
      }
    }
    if (anyErr.status === 0) return true
  }
  if (typeof error === 'string') {
    return (
      error.includes('Failed to fetch') ||
      error.includes('NetworkError') ||
      error.includes('AbortError')
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const anyErr = error as { status?: unknown; message?: unknown }
    if (anyErr.status === 429) return true
    if (typeof anyErr.message === 'string' && anyErr.message.includes('429')) return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  let value: unknown = null
  if (error && typeof error === 'object') {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers
    if (headers && typeof headers === 'object') {
      value = headers['retry-after'] ?? headers['Retry-After']
    }
  }
  if (value == null || value === '') return fallbackMs
  const n = Number(value)
  if (!isFinite(n) || n <= 0) return fallbackMs
  const ms = n * 1000
  return Math.min(MAX_MS, Math.max(MIN_MS, ms))
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
