import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

const RETRY_MIN_MS = 500
const RETRY_MAX_MS = 30000
const RETRY_FALLBACK_MS = 1500

/**
 * Erros de rede/transporte: status 0 (fetch falhou / CORS / offline),
 * AbortError/timeout e mensagens clássicas de rede.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) return error.status === 0
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError'
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
    const msg = error.message || ''
    return (
      /failed to fetch/i.test(msg) ||
      /networkerror/i.test(msg) ||
      /network error/i.test(msg) ||
      /load failed/i.test(msg) ||
      /aborted without reason/i.test(msg)
    )
  }
  return false
}

/** Erro de rate limit (HTTP 429). */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = (error as { status?: unknown }).status
  if (status === 429) return true
  if (error instanceof Error && /\b429\b|too many requests/i.test(error.message || '')) return true
  return false
}

/**
 * Lê o header `retry-after` (segundos) e devolve milissegundos,
 * com clamp em [500, 30000] e fallback quando ausente/inválido.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = RETRY_FALLBACK_MS): number {
  const clamp = (ms: number) => Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, ms))
  const headers = (error as { response?: { headers?: unknown } } | null)?.response?.headers as
    | Record<string, unknown>
    | undefined
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
  const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return clamp(fallbackMs)
  return clamp(seconds * 1000)
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
