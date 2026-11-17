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
 * Erro transitório de rede (status 0, AbortError, "Failed to fetch", 502/503/504).
 * Usado pelo AuthProvider, resilient.ts e banners p/ decidir entre retry e erro real.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (
      error.status === 0 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    ) {
      return true
    }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
    const msg = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('load failed') ||
      msg.includes('signal is aborted') ||
      msg.includes('aborted without reason') ||
      msg.includes('the user aborted') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket connection') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    ) {
      return true
    }
  }
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
    if (e.isAbort === true) return true
  }
  return false
}

/**
 * HTTP 429 (rate limit). Pode vir como ClientResponseError (status 429)
 * ou como Error com "429"/"Too Many Requests" na mensagem.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>
    if ((e as { status?: unknown }).status === 429) return true
  }
  if (error instanceof Error) {
    const msg = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit')) {
      return true
    }
  }
  return false
}

/**
 * Lê o header Retry-After (segundos) de um erro 429 e converte para ms.
 * Faz clamp entre 500 e 30000ms; se ausente/inválido, usa `fallbackMs`.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN = 500
  const MAX = 30000
  let seconds: number | null = null

  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    const response = e.response as Record<string, unknown> | undefined
    const headers = response?.headers as Record<string, unknown> | undefined
    if (headers) {
      const raw = (headers['retry-after'] ?? headers['Retry-After']) as unknown
      if (typeof raw === 'string' || typeof raw === 'number') {
        const n = Number(raw)
        if (!isNaN(n) && n >= 0) seconds = n
      }
    }
    if (seconds === null && typeof e.retryAfterMs === 'number' && e.retryAfterMs >= 0) {
      return Math.min(MAX, Math.max(MIN, e.retryAfterMs))
    }
    // ClientResponseError pode carregar a mensagem "429 ... retry after Ns"
    if (error instanceof Error) {
      const m = /retry[- ]?after[:\s]+(\d+(?:\.\d+)?)/i.exec(error.message || '')
      if (m) {
        const n = Number(m[1])
        if (!isNaN(n) && n >= 0) seconds = n
      }
    }
  }

  if (seconds === null) return fallbackMs
  return Math.min(MAX, Math.max(MIN, seconds * 1000))
}
