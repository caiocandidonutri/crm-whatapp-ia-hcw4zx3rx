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
  const err = error as { status?: unknown; name?: unknown; message?: unknown }
  if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
    return true
  }
  if (err.name === 'AbortError') return true
  const message = typeof err.message === 'string' ? err.message : ''
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError when attempting to fetch resource') ||
    message.includes('AbortError')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { status?: unknown; message?: unknown }
  if (err.status === 429) return true
  const message = typeof err.message === 'string' ? err.message : ''
  return message.includes('429') || message.toLowerCase().includes('rate limit')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers
  if (!headers) return fallbackMs
  const raw = headers['retry-after'] ?? headers['Retry-After']
  const seconds = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(seconds)) return fallbackMs
  return Math.min(30000, Math.max(500, seconds * 1000))
}
