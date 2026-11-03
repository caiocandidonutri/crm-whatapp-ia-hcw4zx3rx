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
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as any).status === 0
  ) {
    return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('aborterror') ||
    lower.includes('signal is aborted') ||
    lower.includes('network request failed') ||
    lower.includes('econnrefused') ||
    lower.includes('connection refused')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as any).status === 429
  ) {
    return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || msg.toLowerCase().includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  const minMs = 500
  const maxMs = 30000
  if (!error || typeof error !== 'object') return fallbackMs

  const response = (error as any).response
  const headers = response?.headers
  let headerVal: string | undefined

  if (headers && typeof headers.get === 'function') {
    headerVal = headers.get('retry-after') || undefined
  } else if (headers && typeof headers === 'object') {
    headerVal = headers['retry-after'] || headers['Retry-After']
  }

  if (!headerVal) return fallbackMs

  const seconds = parseFloat(headerVal)
  if (Number.isFinite(seconds) && seconds > 0) {
    const ms = seconds * 1000
    return Math.min(Math.max(ms, minMs), maxMs)
  }

  return fallbackMs
}
