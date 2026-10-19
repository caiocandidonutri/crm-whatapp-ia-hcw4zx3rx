import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'string') {
    const s = error.toLowerCase()
    return s.includes('failed to fetch') || s.includes('network') || s.includes('abort')
  }
  if (typeof error === 'object') {
    const err = error as { message?: unknown; name?: unknown; status?: unknown; isAbort?: unknown }
    if (err.isAbort === true) return true
    if (err.name === 'AbortError') return true
    if (typeof err.message === 'string') {
      const m = err.message.toLowerCase()
      if (
        m.includes('failed to fetch') ||
        m.includes('networkerror') ||
        m.includes('network error') ||
        m.includes('aborterror') ||
        m.includes('signal is aborted') ||
        m.includes('connection refused') ||
        m.includes('timeout')
      ) {
        return true
      }
    }
    // ClientResponseError status 0 usually means request was cancelled or network unreachable
    if (err.status === 0) return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const err = error as { status?: unknown; message?: unknown; response?: { status?: unknown } }
    if (err.status === 429 || err.response?.status === 429) return true
    if (
      typeof err.message === 'string' &&
      (err.message.includes('429') || err.message.toLowerCase().includes('too many requests'))
    ) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 2000): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const err = error as { response?: { headers?: Record<string, string | undefined> } }
  const retryHeader =
    err.response?.headers?.['retry-after'] || err.response?.headers?.['Retry-After']
  if (retryHeader) {
    const seconds = parseFloat(retryHeader)
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.round(seconds * 1000)
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
