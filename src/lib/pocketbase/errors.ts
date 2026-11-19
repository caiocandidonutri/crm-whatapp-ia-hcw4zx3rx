import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

const NETWORK_STATUS = new Set([0, 502, 503, 504])

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) return NETWORK_STATUS.has(error.status)
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
    const msg = error.message || ''
    return (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('network') ||
      msg.includes('AbortError') ||
      msg.includes('signal is aborted without reason') ||
      msg.includes('load failed')
    )
  }
  if (typeof error === 'object') {
    const anyErr = error as { status?: unknown; name?: unknown; message?: unknown }
    if (typeof anyErr.status === 'number' && NETWORK_STATUS.has(anyErr.status)) return true
    if (anyErr.name === 'AbortError' || anyErr.name === 'TimeoutError') return true
    if (typeof anyErr.message === 'string' && anyErr.message.includes('Failed to fetch'))
      return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) return error.status === 429
  if (error instanceof Error) {
    return /429|rate.?limit|too many requests/i.test(error.message || '')
  }
  if (typeof error === 'object') {
    const anyErr = error as { status?: unknown; message?: unknown }
    if (anyErr.status === 429) return true
    if (
      typeof anyErr.message === 'string' &&
      /429|rate.?limit|too many requests/i.test(anyErr.message)
    )
      return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  let seconds = NaN
  if (error && typeof error === 'object') {
    const anyErr = error as {
      response?: { headers?: Record<string, unknown> } | null
      headers?: Record<string, unknown> | null
    }
    const headers = anyErr.response?.headers || anyErr.headers || null
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (typeof raw === 'string' || typeof raw === 'number') {
        const n = Number(raw)
        if (isFinite(n)) seconds = n
      }
    }
  }
  if (!isFinite(seconds)) return fallbackMs
  // Header pode vir em segundos (padrão HTTP) — converte para ms.
  const ms = seconds <= 300 ? seconds * 1000 : seconds
  return Math.min(30000, Math.max(500, ms))
}

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
