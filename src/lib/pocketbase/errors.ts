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

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('AbortError') ||
    msg.includes('signal is aborted')
  ) {
    return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null && 'status' in error) {
    if ((error as { status?: number }).status === 429) return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || msg.toLowerCase().includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs: number = 1000): number {
  if (error && typeof error === 'object' && 'response' in error) {
    const res = (error as { response?: { headers?: Record<string, string> } }).response
    const raw = res?.headers?.['retry-after']
    if (raw) {
      const parsedSec = parseFloat(raw)
      if (!isNaN(parsedSec)) {
        const ms = parsedSec * 1000
        return Math.min(30000, Math.max(500, ms))
      }
    }
  }
  return fallbackMs
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}
