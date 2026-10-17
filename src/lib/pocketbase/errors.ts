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
  if (typeof error === 'object') {
    const err = error as any
    if (err.status === 0 || err.statusCode === 0) return true
    if (err.isAbort === true) return true
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return true
    }
    const message = typeof err.message === 'string' ? err.message.toLowerCase() : ''
    if (
      message.includes('failed to fetch') ||
      message.includes('networkerror') ||
      message.includes('network error') ||
      message.includes('load failed') ||
      message.includes('aborterror') ||
      message.includes('abort') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('econnrefused') ||
      message.includes('enetunreach')
    ) {
      return true
    }
    if (err.originalError && isNetworkError(err.originalError)) return true
    if (err.cause && isNetworkError(err.cause)) return true
  }
  return false
}
