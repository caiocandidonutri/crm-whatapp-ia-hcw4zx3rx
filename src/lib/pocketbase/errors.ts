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
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  const msg = error instanceof Error ? error.message : String(error)
  return (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /network error/i.test(msg) ||
    /AbortError/i.test(msg)
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
  }
  return /429|too many requests|rate limit/i.test(
    error instanceof Error ? error.message : String(error),
  )
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  try {
    const headers = (error as { response?: { headers?: Record<string, string> } })?.response
      ?.headers
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (raw) {
        const seconds = parseFloat(raw)
        if (!Number.isNaN(seconds)) {
          const ms = seconds * 1000
          if (ms < 500) return 500
          if (ms > 30000) return 30000
          return ms
        }
      }
    }
  } catch (_e) {
    // fallback abaixo
  }
  return fallbackMs
}
