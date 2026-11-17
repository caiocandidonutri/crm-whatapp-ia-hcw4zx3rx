import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

function getStatus(error: unknown): number | undefined {
  if (error instanceof ClientResponseError) return error.status
  if (error && typeof error === 'object' && 'status' in (error as Record<string, unknown>)) {
    const s = (error as Record<string, unknown>).status
    if (typeof s === 'number') return s
  }
  return undefined
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  const status = getStatus(error)
  if (status === 0 || status === 502 || status === 503 || status === 504) return true
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as { message?: unknown })?.message ?? '')
  if (typeof msg !== 'string') return false
  if (/abort/i.test(msg)) return true
  if (/network|failed to fetch|fetch failed|connection (lost|refused|reset)/i.test(msg)) return true
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const status = getStatus(error)
  if (status === 429) return true
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as { message?: unknown })?.message ?? '')
  if (typeof msg !== 'string') return false
  return /\b429\b|too many requests|rate limit/i.test(msg)
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  let seconds = NaN
  try {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        seconds = parseFloat(String(raw))
      }
    }
  } catch {
    /* intentionally ignored */
  }
  if (Number.isNaN(seconds)) return fallbackMs
  let ms = seconds * 1000
  if (ms < 500) ms = 500
  if (ms > 30000) ms = 30000
  return Math.round(ms)
}
