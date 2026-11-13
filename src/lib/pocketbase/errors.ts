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
  if (error instanceof ClientResponseError) {
    return (
      error.status === 0 ||
      (error.originalError instanceof TypeError && error.originalError.message.includes('fetch'))
    )
  }
  return error instanceof TypeError && error.message.includes('fetch')
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 429
}

export function parseRetryAfterMs(error: unknown, fallbackMs?: number): number | null {
  if (!(error instanceof ClientResponseError)) return null
  const headers = (error.response as unknown as { headers?: Record<string, string> } | undefined)
    ?.headers
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After']
  if (!raw) return fallbackMs ?? null
  const seconds = Number(raw)
  if (!Number.isNaN(seconds)) return Math.max(0, Math.round(seconds * 1000))
  const dateMs = Date.parse(raw)
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())
  return fallbackMs ?? null
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}
