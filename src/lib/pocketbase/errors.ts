import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Erros de rede/transporte: sem status HTTP (0), falha de fetch ou abort.
 * Usado para decidir entre retry silencioso e mostrar erro ao usuário.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) return error.status === 0
  const msg = error instanceof Error ? error.message : String(error)
  return (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /network error/i.test(msg) ||
    /load failed/i.test(msg) ||
    /aborterror/i.test(msg) ||
    /signal is aborted/i.test(msg)
  )
}

/** Erro de rate limit (HTTP 429) vindo do PocketBase ou de string crua. */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status === 429) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return /429|too many requests/i.test(msg)
}

/**
 * Lê o header Retry-After (segundos) de um ClientResponseError e devolve
 * o delay em ms, clampado entre 500 e 30000. Fallback quando ausente.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  let parsed: number | null = null
  if (error && typeof error === 'object') {
    const maybeHeaders = (error as { response?: { headers?: unknown } }).response?.headers
    if (maybeHeaders && typeof (maybeHeaders as Headers).get === 'function') {
      const raw = (maybeHeaders as Headers).get('retry-after')
      if (raw) {
        const n = Number(raw)
        if (!Number.isNaN(n)) parsed = n * 1000
      }
    }
  }
  if (parsed === null) return Math.min(Math.max(fallbackMs, MIN_MS), MAX_MS)
  return Math.min(Math.max(parsed, MIN_MS), MAX_MS)
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
