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
  const err = error as any
  if (err.status === 0 || err.statusCode === 0) return true
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted') ||
    msg.includes('connection refused')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const err = error as any
  if (err.status === 429 || err.statusCode === 429) return true
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  return msg.includes('429') || msg.includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  if (!error) return fallbackMs
  const err = error as any
  const raw =
    err?.response?.headers?.['retry-after'] ||
    err?.headers?.['retry-after'] ||
    err?.response?.headers?.get?.('retry-after')
  if (raw !== undefined && raw !== null && raw !== '') {
    const sec = parseFloat(String(raw))
    if (!isNaN(sec) && sec > 0) {
      const ms = Math.round(sec * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }
  return fallbackMs
}
