import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    return error.status === 0
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('connection refused')
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 429
  ) {
    return true
  }
  if (error instanceof Error && error.message.includes('429')) {
    return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as any).response?.headers
  ) {
    const headers = (error as any).response.headers
    const headerVal =
      typeof headers.get === 'function'
        ? headers.get('retry-after')
        : headers['retry-after'] || headers['Retry-After']
    if (headerVal) {
      const parsedSec = parseFloat(headerVal)
      if (!isNaN(parsedSec)) {
        const ms = parsedSec * 1000
        return Math.max(500, Math.min(30000, ms))
      }
    }
  }
  return Math.max(500, Math.min(30000, fallbackMs))
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
