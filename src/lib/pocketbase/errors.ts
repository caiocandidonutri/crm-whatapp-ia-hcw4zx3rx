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
    const original = error.originalError as { name?: string; message?: string } | undefined
    if (original?.name === 'AbortError' || original?.message?.includes('aborted')) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()
    if (
      name.includes('abort') ||
      name.includes('network') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('aborted') ||
      msg.includes('econnrefused') ||
      msg.includes('networkerror')
    ) {
      return true
    }
  }
  if (typeof error === 'object' && error !== null) {
    const obj = error as { status?: number; name?: string; message?: string; code?: string }
    if (obj.status === 0) return true
    if (obj.code === 'ERR_NETWORK' || obj.code === 'ECONNREFUSED') return true
    if (typeof obj.message === 'string') {
      const m = obj.message.toLowerCase()
      if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('abort')) {
        return true
      }
    }
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    const obj = error as { status?: number; message?: string; response?: { status?: number } }
    if (obj.status === 429 || obj.response?.status === 429) return true
    if (
      typeof obj.message === 'string' &&
      (obj.message.includes('429') || obj.message.toLowerCase().includes('too many requests'))
    ) {
      return true
    }
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs: number = 1000): number {
  if (!error || typeof error !== 'object') return fallbackMs
  const obj = error as { response?: { headers?: Record<string, string | undefined> } }
  const headers = obj.response?.headers
  if (!headers) return fallbackMs
  const retryHeader = headers['retry-after'] || headers['Retry-After']
  if (!retryHeader) return fallbackMs
  const seconds = parseFloat(retryHeader)
  if (!isNaN(seconds) && seconds > 0) {
    return Math.round(seconds * 1000)
  }
  return fallbackMs
}
