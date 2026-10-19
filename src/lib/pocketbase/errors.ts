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

/**
 * Identifica erros de rede, abort e conectividade transitória.
 * REGRA CRÍTICA DO PROJETO: essa função é exportada aqui e protegida por testes.
 * Preservar sempre esta assinatura e comportamento.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (
      e.name === 'AbortError' ||
      e.name === 'CanceledError' ||
      e.code === 20 ||
      e.code === 'ERR_CANCELED' ||
      e.code === 'ABORT_ERR'
    ) {
      return true
    }
    if (e.isAbort === true) return true
    if (e.status === 0 || e.statusCode === 0) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('signal is aborted') ||
      msg.includes('autocancelled') ||
      msg.includes('connection refused') ||
      msg.includes('http n/a')
    ) {
      return true
    }
    if (e.originalError && isNetworkError(e.originalError)) return true
    if (e.cause && isNetworkError(e.cause)) return true
  }
  return false
}

/**
 * Detecta se o erro foi originado por Rate Limit (HTTP 429 Too Many Requests).
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof ClientResponseError) {
    if (err.status === 429) return true
  }
  if (typeof err === 'object') {
    const anyErr = err as Record<string, unknown>
    if (anyErr.status === 429 || anyErr.statusCode === 429) return true
    const resp = anyErr.response
    if (resp && typeof resp === 'object' && (resp as Record<string, unknown>).status === 429) {
      return true
    }
    if (anyErr.originalError && isRateLimitError(anyErr.originalError)) return true
    if (anyErr.cause && isRateLimitError(anyErr.cause)) return true
  }
  const str = String(err).toLowerCase()
  return str.includes('429') || str.includes('too many requests') || str.includes('rate limit')
}

/**
 * Extrai o tempo de espera do cabeçalho Retry-After retornado pelo PocketBase (em ms).
 * Limita entre defaultMs e 5000ms para evitar travar a interface.
 */
export function parseRetryAfterMs(err: unknown, defaultMs = 1200): number {
  try {
    if (err && typeof err === 'object') {
      const anyErr = err as any
      const headers = anyErr.response?.headers || anyErr.originalError?.response?.headers
      if (headers) {
        const raw =
          typeof headers.get === 'function'
            ? headers.get('retry-after') || headers.get('Retry-After')
            : headers['retry-after'] || headers['Retry-After']
        if (raw) {
          const parsed = parseInt(String(raw), 10)
          if (!isNaN(parsed) && parsed > 0) {
            return Math.min(parsed * 1000, 5000)
          }
        }
      }
      const data = anyErr.response?.data || anyErr.data
      if (data && typeof data === 'object' && data['retry-after']) {
        const parsed = parseInt(String(data['retry-after']), 10)
        if (!isNaN(parsed) && parsed > 0) return Math.min(parsed * 1000, 5000)
      }
    }
  } catch {
    // fallback seguro
  }
  return defaultMs
}
