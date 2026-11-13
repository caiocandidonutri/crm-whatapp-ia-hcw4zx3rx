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

/** Erros de rede: sem resposta do servidor (offline, DNS, timeout, conexão recusada). */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof ClientResponseError)) return false
  // status 0 = requisição nem chegou a obter resposta HTTP
  return error.status === 0 || error.isAbort === true
}

/** Erro de rate limit (HTTP 429). */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 429
}

/**
 * Extrai o tempo de espera sugerido pelo servidor a partir do header Retry-After.
 * Aceita segundos (inteiro) ou data HTTP (ex.: "Wed, 21 Oct 2025 07:28:00 GMT").
 * Retorna milissegundos de espera (>= 0), ou null quando não há valor válido.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs?: number | null): number | null {
  if (!(error instanceof ClientResponseError)) return fallbackMs ?? null
  const raw = error.response?.headers?.get?.('retry-after') ?? null
  if (!raw) return fallbackMs ?? null
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10) * 1000)
  }
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return fallbackMs ?? null
  return Math.max(0, date.getTime() - Date.now())
}
