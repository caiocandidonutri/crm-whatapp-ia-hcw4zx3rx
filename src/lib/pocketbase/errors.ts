import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Identifica erros de rede/transporte: fetch abortado, status 0
 * (sem resposta do servidor) ou 502/503/504 (gateway indisponível).
 * Nunca lança — recebe qualquer valor e devolve booleano.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    const status = error.status
    if (status === 0 || status === 502 || status === 503 || status === 504) return true
  }
  if (error instanceof Error) {
    const msg = error.message || ''
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('AbortError')
    ) {
      return true
    }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  }
  return false
}

/**
 * Identifica erros de rate limit (HTTP 429 ou texto "Too Many Requests").
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  const asAny = error as { status?: unknown; message?: unknown }
  if (asAny?.status === 429) return true
  if (error instanceof ClientResponseError && error.status === 429) return true
  if (error instanceof Error && /429|too many requests/i.test(error.message || '')) return true
  return false
}

/**
 * Extrai o header Retry-After (em segundos ou data) e devolve o delay em ms.
 * Faz clamp para o intervalo [500, 30000] ms; usa fallbackMs quando ausente.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const clamp = (ms: number) => Math.min(30000, Math.max(500, ms))
  try {
    const asAny = error as { response?: { headers?: Record<string, unknown> } } | null
    const headers = asAny?.response?.headers
    if (headers) {
      const raw = headers['retry-after'] ?? headers['Retry-After']
      if (raw != null) {
        const str = String(raw).trim()
        const seconds = Number(str)
        if (!Number.isNaN(seconds) && seconds >= 0) return clamp(seconds * 1000)
        const asDate = Date.parse(str)
        if (!Number.isNaN(asDate)) {
          const delta = asDate - Date.now()
          if (delta > 0) return clamp(delta)
        }
      }
    }
  } catch {
    // header malformado — cai no fallback
  }
  return clamp(fallbackMs)
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
