import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.originalError && isNetworkError(error.originalError)) return true
  }
  if (
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 0
  ) {
    return true
  }
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!msg) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('aborterror') ||
    lower.includes('signal is aborted') ||
    lower.includes('load failed') ||
    lower.includes('err_connection')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }
  if (
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: unknown }).status === 429
  ) {
    return true
  }
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!msg) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')
  )
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  let headerVal: string | number | undefined
  if (error && typeof error === 'object') {
    const errObj = error as {
      response?: { headers?: Record<string, unknown> }
      headers?: Record<string, unknown>
    }
    const headers = errObj.response?.headers || errObj.headers
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'retry-after') {
          headerVal = v as string | number
          break
        }
      }
    }
  }

  if (headerVal !== undefined && headerVal !== null) {
    const parsedSec = typeof headerVal === 'number' ? headerVal : parseFloat(String(headerVal))
    if (!Number.isNaN(parsedSec) && parsedSec > 0) {
      const ms = Math.round(parsedSec * 1000)
      return Math.min(Math.max(ms, 500), 30000)
    }
  }

  return Math.min(Math.max(fallbackMs, 500), 30000)
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
