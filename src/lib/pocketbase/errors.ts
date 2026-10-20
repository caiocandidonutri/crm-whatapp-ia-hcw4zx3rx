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

  if (typeof error === 'object') {
    const err = error as Record<string, any>
    if (err.status === 0 || err.statusCode === 0) return true
    if (err.name === 'AbortError' || err.isAbort === true) return true

    const msg = typeof err.message === 'string' ? err.message : ''
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('Network request failed') ||
      msg.includes('AbortError') ||
      msg.includes('signal is aborted') ||
      msg.includes('Load failed') ||
      msg.includes('net::ERR_')
    ) {
      return true
    }

    if (err.originalError && isNetworkError(err.originalError)) return true
    if (err.cause && isNetworkError(err.cause)) return true
  }

  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }

  if (typeof error === 'object') {
    const err = error as Record<string, any>
    if (err.status === 429 || err.statusCode === 429) return true

    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }

    if (err.originalError && isRateLimitError(err.originalError)) return true
    if (err.cause && isRateLimitError(err.cause)) return true
  }

  return false
}

export function parseRetryAfterMs(error: unknown, defaultMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  let retryAfterSeconds: number | null = null

  if (error && typeof error === 'object') {
    const err = error as Record<string, any>
    const headers = err.response?.headers || err.headers || err.responseHeaders || {}

    let rawVal: any = undefined
    if (typeof headers.get === 'function') {
      rawVal = headers.get('retry-after') || headers.get('Retry-After')
    }
    if (rawVal === undefined && typeof headers === 'object') {
      rawVal = headers['retry-after'] ?? headers['Retry-After']
    }

    if (rawVal !== undefined && rawVal !== null) {
      const num = parseFloat(String(rawVal))
      if (!isNaN(num) && num > 0) {
        retryAfterSeconds = num
      }
    }
  }

  const ms = retryAfterSeconds !== null ? retryAfterSeconds * 1000 : defaultMs
  return Math.min(Math.max(ms, MIN_MS), MAX_MS)
}
