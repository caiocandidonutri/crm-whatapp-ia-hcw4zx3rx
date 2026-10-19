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
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('network request failed') ||
      name.includes('abort') ||
      (error as any).isAbort === true
    )
  }
  if (typeof error === 'object' && error !== null) {
    const msg = String((error as any).message || '').toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      Boolean((error as any).isAbort)
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    if ((error as any).status === 429) return true
    const msg = String((error as any).message || '').toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests')) return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, defaultMs = 1000): number {
  if (!error || typeof error !== 'object') return defaultMs
  const headers = (error as any).response?.headers
  if (!headers) return defaultMs
  const retryHeader =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    (typeof headers.get === 'function' ? headers.get('retry-after') : null)
  if (!retryHeader) return defaultMs
  const seconds = Number(retryHeader)
  if (!isNaN(seconds) && seconds > 0) {
    return Math.round(seconds * 1000)
  }
  return defaultMs
}
