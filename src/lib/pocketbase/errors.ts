export interface FieldErrors {
  [key: string]: string
}

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!error || typeof error !== 'object') return {}
  const data = (error as { data?: { data?: Record<string, { message?: string }> } }).data
  if (!data?.data) return {}

  const errors: FieldErrors = {}
  for (const [key, val] of Object.entries(data.data)) {
    if (val && typeof val === 'object' && 'message' in val) {
      errors[key] = String(val.message)
    }
  }
  return errors
}

export function getErrorMessage(error: unknown, fallback = 'Ocorreu um erro inesperado'): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  const pbErr = error as { message?: string }
  if (pbErr.message) return pbErr.message
  return fallback
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('Connection refused')
  )
}
