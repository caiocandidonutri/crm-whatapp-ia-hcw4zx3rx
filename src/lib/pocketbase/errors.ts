import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('abort') || msg.includes('network') || msg.includes('failed to fetch')) {
      return true
    }
  }
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const msg = error.message.toLowerCase()
    if (
      name.includes('abort') ||
      msg.includes('abort') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error')
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
  if (typeof error === 'object' && 'status' in (error as any)) {
    return (error as any).status === 429
  }
  if (error instanceof Error) {
    return (
      error.message.includes('429') ||
      error.message.toLowerCase().includes('too many requests') ||
      error.message.toLowerCase().includes('rate limit')
    )
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const resp = (error as any).response
  const headers = resp?.headers
  let headerVal: string | undefined

  if (headers) {
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after') || headers.get('Retry-After')
    } else if (typeof headers === 'object') {
      headerVal = headers['retry-after'] || headers['Retry-After']
    }
  }

  if (headerVal) {
    const sec = parseFloat(headerVal)
    if (!isNaN(sec) && sec > 0) {
      const ms = Math.round(sec * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }

  return fallbackMs
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
