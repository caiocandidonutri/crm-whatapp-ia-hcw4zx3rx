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

// REGRA PERMANENTE: esta exportação NUNCA pode ser removida deste arquivo.
// Já quebrou o build 5x com MISSING_EXPORT (use-auth.tsx e Index.tsx dependem dela).
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof ClientResponseError) {
    // O PocketBase marca falhas de rede (fetch rejeitado, DNS, offline) com status 0.
    if (error.status === 0) return true
    const msg = (error.message || '').toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('fetch failed') ||
      msg.includes('cors') ||
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('connection refused') ||
      msg.includes('connection reset') ||
      msg.includes('socket connection') ||
      (msg.includes('insufficient') === false && msg.includes('connection closed'))
    )
  }

  // Erros nativos de rede que chegam sem wrapper do PocketBase
  if (error instanceof TypeError) return true

  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('fetch failed') ||
      msg.includes('timed out') ||
      msg.includes('timeout')
    )
  }

  return false
}
