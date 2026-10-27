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
  const err = error as { status?: number; name?: string; message?: string }
  if (err.status === 0) return true
  const msg = (err.message || '').toLowerCase()
  const name = (err.name || '').toLowerCase()
  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('aborterror') ||
    msg.includes('signal is aborted') ||
    name === 'aborterror'
  ) {
    return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const err = error as { status?: number; message?: string }
  if (err.status === 429) return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('429') || msg.includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const err = error as { response?: { headers?: Record<string, string> } }
  const headers = err.response?.headers
  if (!headers) return fallbackMs
  const raw =
    headers['retry-after'] || headers['Retry-After'] || (headers as any).get?.('retry-after')
  if (!raw) return fallbackMs
  const seconds = parseFloat(raw)
  if (Number.isNaN(seconds) || seconds <= 0) return fallbackMs
  const ms = Math.round(seconds * 1000)
  return Math.min(Math.max(ms, 500), 30000)
}
