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
  const e = error as { status?: number; isAbort?: boolean; name?: string; message?: string }
  if (e.status === 0 || e.isAbort === true) return true
  const text = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed') ||
    text.includes('abort') ||
    text.includes('load failed')
  )
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const e = error as { status?: number; message?: string }
  if (e.status === 429) return true
  const text = (e.message ?? '').toLowerCase()
  return text.includes('429') || text.includes('too many requests') || text.includes('rate limit')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1200): number {
  const e = error as { response?: { headers?: Record<string, string> }; headers?: Record<string, string> }
  const headers = e?.response?.headers ?? e?.headers
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
  const seconds = raw !== undefined ? Number(raw) : NaN
  if (!Number.isFinite(seconds)) return fallbackMs
  return Math.min(30000, Math.max(500, Math.round(seconds * 1000)))
}
