import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('aborterror') ||
      msg.includes('aborted') ||
      msg.includes('connection refused')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status
    if (status === 429) return true
  }
  if (error instanceof Error && error.message.includes('429')) return true
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const minMs = 500
  const maxMs = 30000

  if (typeof error === 'object' && error !== null) {
    const res = (error as { response?: { headers?: Record<string, string> } }).response
    const headerVal = res?.headers?.['retry-after'] || res?.headers?.['Retry-After']
    if (headerVal) {
      const parsedSec = parseFloat(headerVal)
      if (!isNaN(parsedSec) && parsedSec > 0) {
        return Math.max(minMs, Math.min(maxMs, Math.round(parsedSec * 1000)))
      }
    }
  }
  return Math.max(minMs, Math.min(maxMs, fallbackMs))
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
