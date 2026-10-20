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
    const msg = (error.message || '').toLowerCase()
    if (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('abort') ||
      msg.includes('connection')
    ) {
      return true
    }
  }
  if (error instanceof Error) {
    const msg = (error.message || '').toLowerCase()
    if (
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('abort') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('connection refused')
    ) {
      return true
    }
    const name = (error.name || '').toLowerCase()
    if (name.includes('network') || name.includes('abort')) {
      return true
    }
  }
  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 0 || e.statusCode === 0) return true
    if (e.isAbort === true) return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 429 || e.statusCode === 429) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 2000): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const e = error as any
  const headers = e.response?.headers
  let headerVal: string | undefined

  if (headers) {
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after') || headers.get('Retry-After')
    } else if (typeof headers === 'object') {
      headerVal = headers['retry-after'] || headers['Retry-After']
    }
  }

  if (headerVal) {
    const parsedSec = parseFloat(headerVal)
    if (!isNaN(parsedSec) && parsedSec > 0) {
      const ms = Math.round(parsedSec * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }

  return fallbackMs
}
