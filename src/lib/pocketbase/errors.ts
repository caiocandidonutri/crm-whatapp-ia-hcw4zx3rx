import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

const NETWORK_STATUSES = new Set([0, 502, 503, 504])

export function isNetworkError(error: unknown): boolean {
  if (error instanceof ClientResponseError) {
    return NETWORK_STATUSES.has(error.status)
  }
  return error instanceof DOMException && error.name === 'AbortError'
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 429
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (error instanceof ClientResponseError) {
    const raw = error.response?.headers?.get?.('retry-after')
    if (raw) {
      const seconds = Number(raw)
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(Math.max(seconds * 1000, 500), 30000)
      }
      const date = Date.parse(raw)
      if (!Number.isNaN(date)) {
        const ms = date - Date.now()
        if (ms >= 0) {
          return Math.min(Math.max(ms, 500), 30000)
        }
      }
    }
  }
  return Math.min(Math.max(fallbackMs, 500), 30000)
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
