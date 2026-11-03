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
  if (typeof error === 'object' && error !== null) {
    const err = error as { status?: number; name?: string; message?: string }
    if (err.status === 0) return true
    const msg = (err.message || '').toLowerCase()
    const name = (err.name || '').toLowerCase()
    if (
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('abort') ||
      name.includes('aborterror')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const err = error as { status?: number; message?: string; response?: { status?: number } }
    if (err.status === 429 || err.response?.status === 429) return true
    const msg = (err.message || '').toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 2000): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const err = error as { response?: { headers?: Record<string, string> } }
  const headers = err.response?.headers
  if (!headers) return fallbackMs

  const retryHeader = headers['retry-after'] || headers['Retry-After'] || headers['retry_after']
  if (!retryHeader) return fallbackMs

  const parsedSec = parseFloat(retryHeader)
  if (Number.isNaN(parsedSec) || parsedSec <= 0) return fallbackMs

  const ms = Math.round(parsedSec * 1000)
  return Math.min(Math.max(ms, 500), 30000)
}
