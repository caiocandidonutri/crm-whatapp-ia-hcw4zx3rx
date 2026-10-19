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
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()
    if (name === 'aborterror' || msg.includes('aborterror') || msg.includes('signal is aborted')) {
      return true
    }
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('connection refused') ||
      msg.includes('net::err') ||
      msg.includes('load failed')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const status = (error as { status?: number }).status
    if (status === 429) return true
    const responseStatus = (error as { response?: { status?: number } }).response?.status
    if (responseStatus === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  try {
    const resp = (error as { response?: { headers?: Record<string, string> } }).response
    const headers = resp?.headers
    if (headers) {
      const headerVal = headers['retry-after'] || headers['Retry-After']
      if (headerVal) {
        const secs = parseFloat(headerVal)
        if (!isNaN(secs) && secs > 0) {
          return Math.round(secs * 1000)
        }
      }
    }
  } catch {
    // fallback
  }
  return fallbackMs
}
