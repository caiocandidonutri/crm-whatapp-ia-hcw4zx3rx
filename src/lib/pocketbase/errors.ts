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
 * Determina se o erro é de rede transitória ou falha de conectividade com PocketBase.
 * ATENÇÃO: NUNCA remover esta função deste arquivo!
 * Ela é importada por use-auth.tsx e Index.tsx. A remoção quebra o build e o runtime.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.status >= 502 && error.status <= 504) return true
  }
  const err = error as Record<string, unknown>
  if (typeof err.status === 'number' && err.status === 0) return true
  const msg = String(err.message || '').toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('abort') ||
    msg.includes('econnrefused') ||
    msg.includes('err_connection_refused') ||
    msg.includes('load failed')
  )
}
