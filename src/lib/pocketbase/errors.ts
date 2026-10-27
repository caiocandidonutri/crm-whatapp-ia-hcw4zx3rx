import { ClientResponseError } from 'pocketbase'

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('load failed') ||
      msg.includes('offline')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    if ((error as { status: unknown }).status === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests')) return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, defaultMs = 1000): number {
  if (!error || typeof error !== 'object') return defaultMs
  const anyErr = error as Record<string, unknown>
  const response = anyErr.response as Record<string, unknown> | undefined
  const headers = (response?.headers || anyErr.headers) as Record<string, string> | undefined
  let headerVal: string | undefined
  if (headers && typeof headers === 'object') {
    headerVal = headers['retry-after'] || headers['Retry-After']
  }
  if (headerVal) {
    const parsedSec = Number.parseFloat(headerVal)
    if (!Number.isNaN(parsedSec) && parsedSec > 0) {
      const ms = Math.round(parsedSec * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }
  return Math.min(Math.max(defaultMs, 500), 30000)
}

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
