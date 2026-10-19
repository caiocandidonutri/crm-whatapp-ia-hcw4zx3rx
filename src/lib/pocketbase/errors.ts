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
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('load failed') ||
      name.includes('aborterror')
    ) {
      return true
    }
  }
  if (error instanceof ClientResponseError) {
    if (error.status === 0 || error.isAbort) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    if ('status' in error && (error as { status: unknown }).status === 429) {
      return true
    }
    if (error instanceof ClientResponseError && error.status === 429) {
      return true
    }
    if (error instanceof Error && error.message.includes('429')) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const response = (error as { response?: { headers?: Record<string, string> } }).response
  const retryHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After']
  if (retryHeader) {
    const seconds = parseInt(retryHeader, 10)
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 10000)
    }
  }
  return fallbackMs
}
