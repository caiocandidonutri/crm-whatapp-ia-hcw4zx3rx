import PocketBase from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

/**
 * Helper para verificar se um erro retornado pelo backend é 429 (Too Many Requests / Rate limit).
 */
export function isAppointmentRateLimited(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    if ('status' in err && (err as { status: unknown }).status === 429) {
      return true
    }
    if ('statusCode' in err && (err as { statusCode: unknown }).statusCode === 429) {
      return true
    }
  }
  const str = String(err).toLowerCase()
  return str.includes('429') || str.includes('too many requests')
}

export { pb }
export default pb
