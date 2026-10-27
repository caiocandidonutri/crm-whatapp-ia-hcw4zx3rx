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
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 0
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return false
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('AbortError') ||
    message.includes('signal is aborted') ||
    message.includes('net::ERR_')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 429
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!message) return false
  return message.includes('429') || /too many requests/i.test(message)
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  let retryAfterSeconds: number | null = null

  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>
    const resp = errObj.response as Record<string, unknown> | undefined
    const headers = (resp?.headers || errObj.headers) as Record<string, unknown> | undefined

    if (headers) {
      const headerVal =
        headers['retry-after'] ||
        headers['Retry-After'] ||
        (typeof (headers as { get?: unknown }).get === 'function'
          ? (headers as { get: (name: string) => unknown }).get('retry-after')
          : undefined)

      if (headerVal !== undefined && headerVal !== null) {
        const parsed = parseFloat(String(headerVal))
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterSeconds = parsed
        }
      }
    }
  }

  if (retryAfterSeconds === null) {
    return fallbackMs
  }

  const ms = Math.round(retryAfterSeconds * 1000)
  return Math.min(Math.max(ms, MIN_MS), MAX_MS)
}
