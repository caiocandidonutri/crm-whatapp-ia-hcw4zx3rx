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
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>
    if (errObj.status === 0 || errObj.statusCode === 0) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('abort') ||
      msg.includes('network error') ||
      msg.includes('connection refused')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    return error.status === 429
  }
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>
    if (errObj.status === 429 || errObj.statusCode === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  let seconds: number | null = null
  if (error && typeof error === 'object') {
    const resp = (error as any).response
    const headers = resp?.headers
    const retryHeader =
      headers?.['retry-after'] ||
      headers?.['Retry-After'] ||
      (typeof headers?.get === 'function' ? headers.get('retry-after') : null)
    if (retryHeader) {
      const parsed = parseFloat(String(retryHeader))
      if (!isNaN(parsed) && parsed > 0) {
        seconds = parsed
      }
    }
  }

  const ms = seconds !== null ? seconds * 1000 : fallbackMs
  // Clamp between 500ms and 30000ms
  return Math.min(30000, Math.max(500, Math.round(ms)))
}
