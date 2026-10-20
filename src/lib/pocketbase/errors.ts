import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

/**
 * Identifica erros de rede, status 0 (offline, CORS, conexão recusada) ou requisições abortadas.
 * Trata ClientResponseError do PocketBase recursivamente ou inspeciona instâncias de Error/objetos.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.originalError && error.originalError !== error) {
      if (isNetworkError(error.originalError)) return true
    }
  }

  const errObj = error as {
    status?: unknown
    name?: unknown
    message?: unknown
    code?: unknown
    originalError?: unknown
  }

  if (errObj.status === 0) return true

  const name = typeof errObj.name === 'string' ? errObj.name.toLowerCase() : ''
  const message = typeof errObj.message === 'string' ? errObj.message.toLowerCase() : ''
  const code = typeof errObj.code === 'string' ? errObj.code.toLowerCase() : ''

  if (
    name.includes('aborterror') ||
    message.includes('aborterror') ||
    message.includes('signal is aborted')
  ) {
    return true
  }

  const networkSubstrings = [
    'failed to fetch',
    'network error',
    'networkerror',
    'load failed',
    'err_connection',
    'econnrefused',
    'econnreset',
    'etimedout',
  ]

  for (const needle of networkSubstrings) {
    if (message.includes(needle) || code.includes(needle)) {
      return true
    }
  }

  if (errObj.originalError && errObj.originalError !== error) {
    if (isNetworkError(errObj.originalError)) return true
  }

  return false
}

/**
 * Identifica respostas de limitação de taxa (HTTP 429 Too Many Requests / Rate Limit).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    if (error.status === 429) return true
    if (error.originalError && error.originalError !== error) {
      if (isRateLimitError(error.originalError)) return true
    }
  }

  const errObj = error as {
    status?: unknown
    statusCode?: unknown
    message?: unknown
    originalError?: unknown
  }

  if (errObj.status === 429 || errObj.statusCode === 429) {
    return true
  }

  const message = typeof errObj.message === 'string' ? errObj.message.toLowerCase() : ''
  if (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit')
  ) {
    return true
  }

  if (errObj.originalError && errObj.originalError !== error) {
    if (isRateLimitError(errObj.originalError)) return true
  }

  return false
}

/**
 * Extrai o valor do cabeçalho `retry-after` (em segundos ou ms) da resposta de erro,
 * convertendo para milissegundos com clamp de 500ms a 30.000ms.
 */
export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN_MS = 500
  const MAX_MS = 30000

  const clamp = (val: number): number => Math.min(Math.max(val, MIN_MS), MAX_MS)

  if (!error || typeof error !== 'object') {
    return clamp(fallbackMs)
  }

  const errObj = error as {
    response?: {
      headers?:
        | Record<string, string | number | undefined>
        | Headers
        | { get?: (name: string) => string | null }
    }
    headers?:
      | Record<string, string | number | undefined>
      | Headers
      | { get?: (name: string) => string | null }
  }

  const findHeader = (
    headersObj:
      | Record<string, string | number | undefined>
      | Headers
      | { get?: (name: string) => string | null }
      | undefined,
  ): string | number | null | undefined => {
    if (!headersObj) return undefined
    if (typeof (headersObj as Headers).get === 'function') {
      return (headersObj as Headers).get('retry-after')
    }
    if (typeof headersObj === 'object') {
      const rec = headersObj as Record<string, string | number | undefined>
      for (const [key, val] of Object.entries(rec)) {
        if (key.toLowerCase() === 'retry-after') {
          return val
        }
      }
    }
    return undefined
  }

  const rawHeader = findHeader(errObj.response?.headers) ?? findHeader(errObj.headers)

  if (rawHeader !== undefined && rawHeader !== null) {
    const parsed = typeof rawHeader === 'number' ? rawHeader : parseFloat(String(rawHeader))
    if (!Number.isNaN(parsed) && parsed >= 0) {
      // Se for menor que 1000, consideramos em segundos (ex: '2' -> 2000ms; '0.1' -> 100ms)
      // Se for valor muito alto pode já ser ms, mas padrão HTTP Retry-After é segundos ou HTTP date.
      const ms = parsed * 1000
      return clamp(ms)
    }
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
