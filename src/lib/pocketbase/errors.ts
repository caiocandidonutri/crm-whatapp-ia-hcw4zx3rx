import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    return error.status === 0
  }
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    if ((error as { status?: unknown }).status === 0) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('aborterror') ||
    lower.includes('aborted') ||
    lower.includes('load failed') ||
    lower.includes('timeout')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    return error.status === 429
  }
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    if ((error as { status?: unknown }).status === 429) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || msg.toLowerCase().includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  if (!error || typeof error !== 'object') return fallbackMs
  let rawHeader: unknown = undefined
  const resp = (error as { response?: { headers?: Record<string, unknown> } }).response
  if (resp && resp.headers) {
    rawHeader = resp.headers['retry-after'] || resp.headers['Retry-After']
  }
  if (rawHeader === undefined || rawHeader === null) {
    return fallbackMs
  }
  const parsedSeconds = Number(rawHeader)
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return fallbackMs
  }
  const ms = Math.round(parsedSeconds * 1000)
  // Clamp between 500ms and 30000ms as per tests and spec
  return Math.min(Math.max(ms, 500), 30000)
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
