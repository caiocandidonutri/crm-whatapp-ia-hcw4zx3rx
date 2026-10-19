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

/**
 * Checks if the error is a network error, timeout, or abort.
 * CRITICAL: Kept permanently to avoid MISSING_EXPORT build regressions.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('aborterror') ||
    lower.includes('signal is aborted') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout')
  )
}

/**
 * Checks if error is an HTTP 429 Rate Limit error.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && (error as { status: number }).status === 429) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || msg.toLowerCase().includes('too many requests')
}

/**
 * Extracts Retry-After duration in milliseconds from error headers or fallback.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { headers?: Record<string, string> } }).response
    const retryAfter = response?.headers?.['retry-after'] || response?.headers?.['Retry-After']
    if (retryAfter) {
      const parsedSeconds = parseInt(retryAfter, 10)
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        return parsedSeconds * 1000
      }
    }
  }
  return fallbackMs
}
