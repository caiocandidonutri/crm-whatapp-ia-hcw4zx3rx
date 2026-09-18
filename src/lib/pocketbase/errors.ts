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

/**
 * Detecta se o erro decorre de falha temporária de rede/conectividade, timeout ou servidor inacessível
 */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false

  // ClientResponseError do PocketBase com status 0 ou mensagem de falha de conexão
  if (err instanceof ClientResponseError) {
    if (err.status === 0) return true
    const msg = (err.message || '').toLowerCase()
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('connection refused')
    ) {
      return true
    }
  }

  // Erro padrão JS ou objeto genérico
  const anyErr = err as any
  const status = anyErr?.status || anyErr?.response?.status
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return true
  }

  const msg = (anyErr?.message || String(err)).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('err_connection') ||
    msg.includes('abort')
  )
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0 ? msgs.join(' ') : error.message || 'An unexpected error occurred.'
}
