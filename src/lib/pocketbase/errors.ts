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
    if (error.status === 0) return true
  }
  const err = error as any
  if (err.status === 0) return true
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted') ||
    msg.includes('connection refused')
  ) {
    return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const err = error as any
  if (err.status === 429) return true
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 2000): number {
  if (!error) return fallbackMs
  const err = error as any
  const headers = err?.response?.headers || err?.headers
  const rawHeader = headers?.['retry-after'] || headers?.get?.('retry-after')
  if (rawHeader) {
    const parsedSec = parseFloat(rawHeader)
    if (!isNaN(parsedSec) && parsedSec > 0) {
      const ms = parsedSec * 1000
      return Math.max(500, Math.min(30000, Math.round(ms)))
    }
  }
  return fallbackMs
}
