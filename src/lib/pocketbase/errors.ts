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
 * Determina se um erro representa falha de conexão/rede ou cancelamento de requisição.
 * - TypeError ("Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed")
 * - Erros PocketBase / HTTP sem status real (status undefined ou 0)
 * - Abortos e cancelamentos (AbortError, CanceledError, isAbort)
 * - Busca recursiva segura em `cause` e `originalError` com proteção anti-loop
 * - Retorna false para respostas HTTP reais (400, 401, 403, 404, 500 etc.)
 * - Sempre encapsulado internamente em try/catch para nunca lançar exceção.
 */
export function isNetworkError(error: unknown, visited = new Set<unknown>()): boolean {
  try {
    if (!error || visited.has(error)) {
      return false
    }

    if (typeof error !== 'object') {
      return false
    }

    visited.add(error)
    const err = error as Record<string, any>

    // Se possui status HTTP real (>= 100), NÃO é erro puramente de rede/conexão
    const rawStatus = err.status ?? err.response?.status
    const statusNum = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus)
    if (!Number.isNaN(statusNum) && statusNum >= 100) {
      return false
    }

    // Cancelamento ou aborto de requisição
    if (
      err.name === 'AbortError' ||
      err.name === 'CanceledError' ||
      err.code === 20 ||
      err.isAbort === true
    ) {
      return true
    }

    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''

    // Padrões clássicos de falha de conexão no browser (fetch API)
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('load failed') ||
      msg.includes('net::err_') ||
      msg.includes('signal is aborted') ||
      msg.includes('the user aborted a request') ||
      msg.includes('fetch is aborted')
    ) {
      return true
    }

    // ClientResponseError do PocketBase com status 0 ou undefined (ex: offline, fetch falhou antes de receber resposta)
    if (err instanceof ClientResponseError) {
      if (!err.status || err.status === 0) {
        return true
      }
    }

    // Propriedade status 0 explícita comum em adapters fetch
    if (rawStatus === 0) {
      return true
    }

    // Avaliação recursiva de causas encapsuladas
    if (err.cause && isNetworkError(err.cause, visited)) {
      return true
    }
    if (err.originalError && isNetworkError(err.originalError, visited)) {
      return true
    }

    return false
  } catch {
    return false
  }
}
