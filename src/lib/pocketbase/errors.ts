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

function errorText(error: unknown): string {
  return (
    (error instanceof Error ? error.message : typeof error === 'string' ? error : '') || ''
  ).toLowerCase()
}

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status?: unknown }).status
    if (typeof s === 'number') return s
  }
  return undefined
}

export function isNetworkError(error: unknown): boolean {
  // 0 = falha de rede/CORS/timeout (sem resposta HTTP); 502/503/504 = gateway instável
  const status = errorStatus(error)
  if (status === 0 || status === 502 || status === 503 || status === 504) return true
  const text = errorText(error)
  if (!text) return false
  return (
    text.includes('network') ||
    text.includes('failed to fetch') ||
    text.includes('fetch failed') ||
    text.includes('aborterror') ||
    text.includes('signal is aborted')
  )
}

export function isRateLimitError(error: unknown): boolean {
  const status = errorStatus(error)
  if (status === 429) return true
  const text = errorText(error)
  return text.includes('429') || text.includes('too many requests')
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const response =
    error && typeof error === 'object' && 'response' in error
      ? (error as { response?: { headers?: Record<string, unknown> } }).response
      : undefined
  const headers = response?.headers ?? {}
  const raw = headers['retry-after'] ?? headers['Retry-After']
  const seconds = typeof raw === 'string' ? parseFloat(raw) : NaN
  if (Number.isFinite(seconds) && seconds >= 0) {
    // clamp entre 500ms e 30s para não travar o fluxo nem martelar o backend
    return Math.min(30000, Math.max(500, seconds * 1000))
  }
  return fallbackMs
}
