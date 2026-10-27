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
  if (error instanceof ClientResponseError && error.status === 0) return true
  if (typeof error === 'object' && 'status' in (error as any) && (error as any).status === 0)
    return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('abort') ||
      msg.includes('timeout')
    )
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError && error.status === 429) return true
  if (typeof error === 'object' && 'status' in (error as any) && (error as any).status === 429)
    return true
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('429') || msg.includes('too many requests')
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1000): number {
  let val: string | null = null
  if (error instanceof ClientResponseError && error.response?.headers) {
    val =
      error.response.headers.get?.('retry-after') ||
      (error.response.headers as any)['retry-after'] ||
      null
  } else if (typeof error === 'object' && error !== null && 'headers' in error) {
    val = (error as any).headers?.['retry-after'] || null
  }
  if (!val) return fallbackMs
  const seconds = parseFloat(val)
  if (isNaN(seconds) || seconds <= 0) return fallbackMs
  const ms = Math.round(seconds * 1000)
  return Math.min(Math.max(ms, 500), 30000)
}
