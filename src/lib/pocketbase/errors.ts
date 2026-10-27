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
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    if ((error as { status: unknown }).status === 0) return true
  }
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('aborterror') ||
    lower.includes('signal is aborted') ||
    lower.includes('the user aborted a request') ||
    lower.includes('err_connection_refused') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_internet_disconnected')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 429) return true
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    if ((error as { status: unknown }).status === 429) return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('429') || message.toLowerCase().includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  if (!error || typeof error !== 'object') return fallbackMs
  try {
    const errObj = error as { response?: { headers?: Record<string, unknown> } }
    const headers = errObj.response?.headers
    if (headers && typeof headers === 'object') {
      const headerVal =
        headers['retry-after'] ||
        headers['Retry-After'] ||
        (headers as unknown as { get?: (k: string) => string | null }).get?.('retry-after')
      if (typeof headerVal === 'string' || typeof headerVal === 'number') {
        const sec = parseFloat(String(headerVal))
        if (!isNaN(sec) && sec > 0) {
          // Clamp between 500ms and 30000ms
          return Math.min(30000, Math.max(500, Math.round(sec * 1000)))
        }
      }
    }
  } catch {
    // ignore parse error and use fallback
  }
  return fallbackMs
}
