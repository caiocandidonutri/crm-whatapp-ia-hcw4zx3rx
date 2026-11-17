import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

// CONTRATO FIXADO POR src/lib/pocketbase/errors.test.ts — NÃO REMOVER NENHUMA
// DAS 5 EXPORTAÇÕES. resilient.ts importa 3 delas no boot do módulo: se faltar
// qualquer uma, o build quebra com MISSING_EXPORT e / (e /conversas) caem no
// ErrorBoundary global. Este arquivo já foi truncado 7x — se reaparecer o
// sintoma, restaurar conforme os testes abaixo.
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ClientResponseError) {
    return (
      error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504
    )
  }
  if (error instanceof Error) {
    const m = error.message || ''
    if (m.includes('Failed to fetch')) return true
    if (m.includes('NetworkError')) return true
    if (m.includes('AbortError')) return true
    if (m.includes('signal is aborted without reason')) return true
    if (m.includes('timeout') || m.includes('Timeout')) return true
  }
  return false
}

export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (status === 429) return true
  }
  if (error instanceof Error) {
    const m = error.message || ''
    if (m.includes('429') && m.includes('Too Many Requests')) return true
    if (m.includes('rate limit') || m.includes('Rate limit')) return true
  }
  return false
}

export function parseRetryAfterMs(error: unknown, fallbackMs = 1500): number {
  const MIN = 500
  const MAX = 30000
  try {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers
    if (headers) {
      const raw =
        (headers['retry-after'] as string | undefined) ??
        (headers['Retry-After'] as string | undefined)
      if (raw !== undefined) {
        const n = Number(raw)
        if (Number.isFinite(n)) {
          return Math.min(MAX, Math.max(MIN, n * 1000))
        }
      }
    }
  } catch {
    /* intentionally ignored */
  }
  return Math.min(MAX, Math.max(MIN, fallbackMs))
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
