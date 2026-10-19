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

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof ClientResponseError) {
    if (error.status === 0) return true
    if (error.isAbort) return true
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    const name = error.name.toLowerCase()
    if (name.includes('abort') || msg.includes('abort')) return true
    if (
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('connection') ||
      msg.includes('load failed') ||
      msg.includes('timeout') ||
      msg.includes('offline')
    ) {
      return true
    }
  }
  if (typeof error === 'object' && 'name' in error) {
    const name = String((error as { name?: unknown }).name).toLowerCase()
    if (name.includes('abort') || name.includes('network')) return true
  }
  return false
}
