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
    return error.status === 0
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('timeout')
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status
    if (status === 429) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')
  }
  return false
}

export function parseRetryAfterMs(error: unknown, defaultMs = 1200): number {
  if (!error || typeof error !== 'object') return defaultMs
  try {
    const headers = (error as any)?.response?.headers
    const headerVal =
      headers?.['retry-after'] ||
      headers?.['Retry-After'] ||
      (typeof headers?.get === 'function' ? headers.get('retry-after') : null)
    if (headerVal) {
      const parsedSeconds = parseFloat(headerVal)
      if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
        const ms = parsedSeconds * 1000
        return Math.min(Math.max(ms, 500), 30000)
      }
    }
  } catch {
    // fallback
  }
  return defaultMs
}
