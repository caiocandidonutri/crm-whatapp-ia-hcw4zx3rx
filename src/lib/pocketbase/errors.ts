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
  if (!error || typeof error !== 'object') return false
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    const msg = error.message || ''
    return /failed to fetch|networkerror when attempting to fetch resource|network request failed/i.test(
      msg,
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (error instanceof ClientResponseError && error.status === 429) return true
  const status = (error as { status?: unknown }).status
  if (status === 429) return true
  if (error instanceof Error) {
    return /too many requests|\b429\b|rate limit/i.test(error.message || '')
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  try {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (raw !== undefined && raw !== null) {
        const value = Number(raw)
        if (Number.isFinite(value)) {
          return Math.min(30000, Math.max(500, value * 1000))
        }
      }
    }
  } catch {
    // ignore malformed payloads
  }
  return fallbackMs
}
