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
    const originalMsg = error.originalError instanceof Error ? error.originalError.message : ''
    if (/network|fetch|abort|failed to fetch/i.test(originalMsg)) return true
  }
  if (error instanceof Error) {
    const msg = error.message || ''
    const name = error.name || ''
    if (name === 'AbortError') return true
    if (/network|failed to fetch|load failed|networkerror|abort/i.test(msg)) return true
  }
  return false
}
