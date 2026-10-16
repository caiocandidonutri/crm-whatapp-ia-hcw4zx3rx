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
  if (typeof error === 'object') {
    const err = error as any
    if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 20) return true
    if (err.isAbort === true) return true
    if (err.status === 0 || err.statusCode === 0) return true
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('abort') ||
      msg.includes('signal is aborted') ||
      msg.includes('timeout') ||
      msg.includes('autocancelled') ||
      msg.includes('load failed') ||
      msg.includes('user aborted')
    ) {
      return true
    }
    if (err.originalError && isNetworkError(err.originalError)) return true
    if (err.cause && isNetworkError(err.cause)) return true
  }
  return false
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}
