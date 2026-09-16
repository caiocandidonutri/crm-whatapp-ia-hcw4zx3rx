import PocketBase, { ClientResponseError } from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

export function isAppointmentRateLimited(err: unknown): boolean {
  if (err instanceof ClientResponseError && err.status === 429) {
    return true
  }
  const str = String(err || '').toLowerCase()
  return str.includes('429') || str.includes('too many requests')
}

// Wrapper global de retry com backoff exponencial para requisições com 429 ou transitórias
const originalSend = pb.send.bind(pb)

pb.send = async function (path: string, options: any = {}) {
  const maxRetries = 3
  const delays = [1500, 3500, 7000]
  let attempts = 0

  while (attempts <= maxRetries) {
    try {
      return await originalSend(path, options)
    } catch (err: unknown) {
      const is429 =
        (err instanceof ClientResponseError && err.status === 429) ||
        (err instanceof Error &&
          (err.message.includes('429') || err.message.toLowerCase().includes('too many requests')))

      if (is429 && attempts < maxRetries) {
        // Tentar extrair header Retry-After se disponível
        let delayMs = delays[attempts]
        if (err instanceof ClientResponseError && err.response) {
          const retryAfter = err.response.headers?.get?.('retry-after')
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10)
            if (!isNaN(parsed) && parsed > 0) {
              delayMs = Math.min(parsed * 1000, 10000)
            }
          }
        }

        // Adicionar pequeno jitter aleatório (+- 200ms)
        const jitter = Math.floor(Math.random() * 400) - 200
        const totalDelay = Math.max(500, delayMs + jitter)

        console.warn(
          `[pb.send] 429 Too Many Requests ao acessar ${path}. Tentativa ${attempts + 1}/${maxRetries} com espera de ${totalDelay}ms...`,
        )

        await new Promise((resolve) => setTimeout(resolve, totalDelay))
        attempts++
        continue
      }

      throw err
    }
  }

  return originalSend(path, options)
}

export default pb
