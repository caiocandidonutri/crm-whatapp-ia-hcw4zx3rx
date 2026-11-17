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
  if (typeof error === 'string') {
    const s = error.toLowerCase()
    return (
      s.includes('networkerror') ||
      s.includes('failed to fetch') ||
      s.includes('aborterror') ||
      s.includes('aborted')
    )
  }
  if (error instanceof Error) {
    const name = (error.name || '').toLowerCase()
    if (name === 'aborterror' || name === 'timeouterror') return true
    const msg = (error.message || '').toLowerCase()
    if (
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('aborted') ||
      msg.includes('signal is aborted')
    ) {
      return true
    }
  }
  if (typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    const status = (error as { status?: unknown }).status
    return status === 0 || status === 502 || status === 503 || status === 504
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
  }
  if (error instanceof Error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
    const name = (error.name || '').toLowerCase()
    if (name.includes('429') || name.includes('rate limit')) return true
  }
  if (typeof error === 'string') {
    const s = error.toLowerCase()
    if (s.includes('429') || s.includes('too many requests') || s.includes('rate limit'))
      return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000
  let parsed = NaN
  try {
    const response = (error as { response?: { headers?: Record<string, unknown> } })?.response
    const headers = response?.headers
    if (headers) {
      const keys = Object.keys(headers)
      const key = keys.find((k) => k.toLowerCase() === 'retry-after')
      if (key) {
        const raw = headers[key]
        const num = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN
        if (!isNaN(num)) parsed = num * 1000
      }
    }
    if (isNaN(parsed) && typeof error === 'object' && error !== null) {
      const msg = (error as { message?: unknown }).message
      if (typeof msg === 'string') {
        const m = msg.match(/retry[-\s]?after[:\s]*(\d+(?:\.\d+)?)/i)
        if (m) parsed = parseFloat(m[1]) * 1000
      }
    }
  } catch {
    // fall through to fallback
  }
  if (isNaN(parsed)) return fallbackMs
  return Math.min(MAX_MS, Math.max(MIN_MS, parsed))
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}
