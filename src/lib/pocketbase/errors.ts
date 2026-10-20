import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof ClientResponseError) {
    if (err.status === 0) return true
  }
  if (typeof err === 'object') {
    const e = err as any
    if (e.status === 0 || e.statusCode === 0) return true
    if (e.name === 'AbortError' || e.name === 'CanceledError' || e.name === 'TimeoutError')
      return true
    if (e.code === 20 || e.code === 'ERR_CANCELED' || e.code === 'ABORT_ERR') return true
    if (e.isAbort === true) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('signal is aborted') ||
      msg.includes('connection refused')
    ) {
      return true
    }
  }
  return false
}

export function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as any
    if (e.status === 429 || e.statusCode === 429) return true
    const msg = typeof e.message === 'string' ? e.message : ''
    if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const e = error as any
  const rawHeader =
    e?.response?.headers?.['retry-after'] ||
    e?.response?.headers?.get?.('retry-after') ||
    e?.headers?.['retry-after']
  if (rawHeader) {
    const parsedSec = parseFloat(rawHeader)
    if (!isNaN(parsedSec) && parsedSec > 0) {
      const ms = Math.round(parsedSec * 1000)
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
