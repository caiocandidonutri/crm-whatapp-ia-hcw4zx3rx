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
    (error as any).status === 0
  ) {
    return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('aborterror') ||
    lower.includes('abort') ||
    lower.includes('connection refused') ||
    lower.includes('timeout')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 429) return true
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

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const response = (error as any).response
  const headers = response?.headers
  let headerVal: any = null

  if (headers) {
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after')
    } else if (typeof headers === 'object') {
      headerVal = headers['retry-after'] || headers['Retry-After']
    }
  }

  if (headerVal !== null && headerVal !== undefined) {
    const parsed = parseFloat(String(headerVal))
    if (!isNaN(parsed) && parsed >= 0) {
      // Valor em segundos conforme especificação HTTP
      const ms = Math.round(parsed * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }

  return fallbackMs
}
