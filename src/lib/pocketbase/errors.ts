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
 * Identifica se um erro é de rede/conexão (fetch falhou, TypeError "Failed to fetch",
 * timeout, sinal abortado pelo browser ou status HTTP 0).
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.isAbort) return true
  }

  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 0 || e.statusCode === 0) return true
    if (e.isAbort === true) return true

    const name = typeof e.name === 'string' ? e.name : ''
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    const code = typeof e.code === 'string' ? e.code : ''

    if (
      name === 'AbortError' ||
      name === 'CanceledError' ||
      name === 'TimeoutError' ||
      name === 'NetworkError'
    ) {
      return true
    }

    if (
      code === 'ECONNRESET' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'ERR_NETWORK'
    ) {
      return true
    }

    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('aborterror') ||
      msg.includes('signal is aborted') ||
      msg.includes('user aborted') ||
      msg.includes('connection refused') ||
      msg.includes('econnrefused') ||
      msg.includes('net::') ||
      msg.includes('timeout')
    ) {
      return true
    }

    if (e.originalError && isNetworkError(e.originalError)) return true
    if (e.cause && isNetworkError(e.cause)) return true
  }

  return false
}

/**
 * Identifica se um erro é HTTP 429 (Rate Limit) por status ou mensagem.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
  }

  if (typeof error === 'object') {
    const e = error as any
    if (e.status === 429 || e.statusCode === 429 || e.response?.status === 429) {
      return true
    }

    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return true
    }

    if (e.originalError && isRateLimitError(e.originalError)) return true
    if (e.cause && isRateLimitError(e.cause)) return true
  }

  return false
}

/**
 * Extrai o header Retry-After (segundos) do erro ou dados de resposta,
 * converte para ms, aplicando clamp mínimo de 500ms e máximo de 30000ms.
 * Se ausente ou inválido, retorna fallbackMs (também com clamp).
 */
export function parseRetryAfterMs(error: unknown, fallbackMs: number = 1000): number {
  const clamp = (val: number) => Math.min(30000, Math.max(500, val))

  if (!error || typeof error !== 'object') {
    return clamp(fallbackMs)
  }

  const e = error as any
  let headerVal: string | number | undefined

  if (e.response?.headers) {
    const headers = e.response.headers
    if (typeof headers.get === 'function') {
      headerVal = headers.get('retry-after') || headers.get('Retry-After')
    } else {
      headerVal = headers['retry-after'] || headers['Retry-After']
    }
  }

  if (headerVal === undefined && e.response?.data?.retry_after) {
    headerVal = e.response.data.retry_after
  }

  if (headerVal === undefined && e.retryAfter !== undefined) {
    headerVal = e.retryAfter
  }

  if (headerVal !== undefined) {
    const seconds = typeof headerVal === 'number' ? headerVal : parseFloat(String(headerVal))
    if (!isNaN(seconds) && seconds > 0) {
      return clamp(Math.round(seconds * 1000))
    }
  }

  return clamp(fallbackMs)
}
