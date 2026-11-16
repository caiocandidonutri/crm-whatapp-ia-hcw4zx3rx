import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/** Erros de rede / abort / status 0 (conexão caiu, offline, timeout de fetch). */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (error instanceof Error) {
    const name = error.name || ''
    if (name === 'AbortError' || name === 'TimeoutError' || name === 'NetworkError') return true
    const msg = error.message || ''
    const m = msg.toLowerCase()
    return (
      m.includes('failed to fetch') ||
      m.includes('networkerror') ||
      m.includes('network error') ||
      m.includes('aborterror') ||
      m.includes('signal is aborted') ||
      m.includes('load failed')
    )
  }
  return false
}

/** Erros de rate limit (HTTP 429 / "Too Many Requests"). */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
  }
  if (error instanceof Error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }
  return false
}

/**
 * Lê o header `retry-after` (segundos) e devolve o delay em ms,
 * clampado entre 500ms e 30000ms. Fallback quando ausente/inválido.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  let seconds: number | null = null
  try {
    const headers = (error as { response?: { headers?: Record<string, unknown> } } | null)?.response
      ?.headers
    if (headers) {
      const raw =
        (headers['retry-after'] as string | undefined) ??
        (headers['Retry-After'] as string | undefined)
      if (raw) {
        const parsed = parseFloat(String(raw))
        if (!Number.isNaN(parsed)) seconds = parsed
      }
    }
  } catch {
    // ignora — usa fallback
  }
  if (seconds === null) return Math.min(Math.max(fallbackMs, MIN_MS), MAX_MS)
  const ms = seconds * 1000
  return Math.min(Math.max(ms, MIN_MS), MAX_MS)
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
