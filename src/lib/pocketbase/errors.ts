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
  if (!(error instanceof ClientResponseError)) return false
  // status 0 = falha de rede/conexão (sem resposta HTTP)
  return error.status === 0 || error.message === 'Network Error'
}

export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof ClientResponseError)) return false
  return error.status === 429
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const headers = (error as { response?: { headers?: Record<string, string> } }).response?.headers
    const retryAfter = headers?.['retry-after']
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000
      const dateMs = Date.parse(retryAfter)
      if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())
    }
  }
  return fallbackMs
}
