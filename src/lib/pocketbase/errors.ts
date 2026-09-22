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
    return error.status === 0 || error.status >= 500
  }
  if (typeof error === 'object' && error !== null) {
    const err = error as any
    if (err.status === 0 || (typeof err.status === 'number' && err.status >= 500)) return true
    if (
      err.name === 'TypeError' &&
      typeof err.message === 'string' &&
      err.message.includes('Failed to fetch')
    ) {
      return true
    }
    if (
      typeof err.message === 'string' &&
      (err.message.includes('NetworkError') || err.message.includes('fetch failed'))
    ) {
      return true
    }
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
