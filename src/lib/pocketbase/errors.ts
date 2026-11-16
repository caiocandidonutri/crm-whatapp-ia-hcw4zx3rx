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

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    // status 0 = request never got a response (offline, CORS, timeout)
    return error.status === 0
  }
  if (error instanceof Error) {
    const msg = error.message || ''
    if (
      /failed to fetch|networkerror|network error|aborterror|aborted without reason|load failed/i.test(
        msg,
      )
    ) {
      return true
    }
    // fetch aborts surface as DOMException with name AbortError
    if ((error as { name?: string }).name === 'AbortError') return true
    const status = (error as unknown as { status?: unknown }).status
    if (typeof status === 'number') return status === 0
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status =
    error instanceof ClientResponseError
      ? error.status
      : typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined
  if (status === 429) return true
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\b429\b|too many requests|rate limit/i.test(msg)
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  const headers =
    error && typeof error === 'object'
      ? (error as { response?: { headers?: Record<string, unknown> } }).response?.headers
      : undefined
  const raw = headers ? (headers['retry-after'] ?? headers['Retry-After']) : undefined
  const seconds = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN
  const ms = Number.isFinite(seconds) ? seconds * 1000 : fallbackMs
  return Math.min(MAX_MS, Math.max(MIN_MS, ms))
}
