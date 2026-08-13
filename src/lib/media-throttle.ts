import pb from '@/lib/pocketbase/client'

/**
 * Fila global de download de mídias do PocketBase com throttle.
 *
 * Problema: quando uma conversa tem muitos áudios/imagens/documentos, o
 * navegador tentava baixar TODOS de uma vez (cada `<img src>`/`<audio src>`
 * dispara uma requisição imediata). O PocketBase responde com 429 Too Many
 * Requests e as mídias quebram.
 *
 * Solução: centralizamos o fetch de mídia aqui. No máximo `MAX_CONCURRENT`
 * requisições simultâneas, com intervalo mínimo de `MIN_INTERVAL_MS` entre
 * o início de cada uma. Resultados (object URLs) são cacheados por URL
 * bruta para que re-renderizações e trocas de aba não baixem de novo.
 *
 * Como funciona:
 *  - `getMediaObjectUrl(url)` devolve um Promise<string> (object URL) assim que
 *    vaga na fila + throttle liberam.
 *  - Internamente faz `fetch(url)` com as credenciais do PocketBase
 *    (Bearer token via `pb.authStore.token`) — necessário porque os arquivos
 *    do PocketBase exigem auth, e `<img src=url>` não envia Authorization.
 *    Antes o app dependia do cookie do PB; em domínios diferentes (app vs
 *    API) o cookie não trafega, daí o 429/403. Agora vai via fetch com header.
 *  - O object URL retornado é revogado apenas quando não há mais referências
 *    (refs por contador). Por simplicidade, mantemos cache pela sessão.
 *
 * Retry: cada URL pode ser reencaminhado manualmente via `retryMedia(url)`.
 * Internamente limitamos a `MAX_ATTEMPTS` tentativas por URL nesta sessão
 * (1 inicial + 1 retry), para não martelar o backend em caso de mídia
 * realmente indisponível (404/403 permanente).
 */

const MAX_CONCURRENT = 3
const MIN_INTERVAL_MS = 200
/** Tentativas máximas por URL nesta sessão (1 inicial + 1 retry). */
const MAX_ATTEMPTS = 2

type Job = {
  url: string
  resolve: (objectUrl: string) => void
  reject: (err: unknown) => void
}

const queue: Job[] = []
let active = 0
let lastDispatch = 0

/** Cache: URL bruta → object URL já baixada nesta sessão. */
const cache = new Map<string, string>()
/** Promises em andamento por URL (dedupe de fetches concorrentes). */
const inflight = new Map<string, Promise<string>>()
/** Contador de referências por object URL, para saber quando revogar. */
const refCount = new Map<string, number>()
/** Tentativas já gastas por URL nesta sessão (para o retry manual). */
const attempts = new Map<string, number>()

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    active++
    // Throttle: garante intervalo mínimo entre inícios de download.
    const now = Date.now()
    const wait = Math.max(0, lastDispatch + MIN_INTERVAL_MS - now)
    lastDispatch = now + wait
    if (wait > 0) {
      setTimeout(() => runJob(job), wait)
    } else {
      runJob(job)
    }
  }
}

async function runJob(job: Job) {
  try {
    // Token fresco: lê do authStore no momento do fetch. O token pode ter
    // sido renovado desde o enqueue (ex.: refresh automático do use-realtime),
    // então sempre pegamos o valor atual — nunca um snapshot antigo.
    const headers: Record<string, string> = {}
    const token = pb.authStore.token
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(job.url, { headers })
    if (!res.ok) {
      throw new Error(`media fetch ${res.status}`)
    }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    cache.set(job.url, objectUrl)
    refCount.set(objectUrl, (refCount.get(objectUrl) || 0) + 1)
    inflight.delete(job.url)
    attempts.delete(job.url)
    job.resolve(objectUrl)
  } catch (err) {
    inflight.delete(job.url)
    job.reject(err)
  } finally {
    active--
    pump()
  }
}

function enqueue(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    queue.push({ url, resolve, reject })
    pump()
  })
}

/**
 * Baixa uma mídia do PocketBase respeitando o throttle (máx 3 concorrentes,
 * 200ms entre inícios). Retorna um object URL (blob:) que pode ser usado
 * em `<img src>` / `<audio src>` / `<a href download>`.
 *
 * Resultados são cacheados: chamadas repetidas com a mesma URL retornam
 * imediatamente o mesmo object URL.
 */
export function getMediaObjectUrl(url: string): Promise<string> {
  const cached = cache.get(url)
  if (cached) {
    refCount.set(cached, (refCount.get(cached) || 0) + 1)
    return Promise.resolve(cached)
  }
  const existing = inflight.get(url)
  if (existing) return existing

  attempts.set(url, (attempts.get(url) || 0) + 1)
  const p = enqueue(url)
  inflight.set(url, p)
  return p
}

/**
 * Libera uma referência a um object URL. Quando o contador chega a zero,
 * revoga o object URL (libera memória). Seguro chamar várias vezes.
 */
export function releaseMediaObjectUrl(url: string) {
  const objectUrl = cache.get(url)
  if (!objectUrl) return
  const c = (refCount.get(objectUrl) || 1) - 1
  if (c <= 0) {
    refCount.delete(objectUrl)
    URL.revokeObjectURL(objectUrl)
    cache.delete(url)
  } else {
    refCount.set(objectUrl, c)
  }
}

/**
 * Força uma nova tentativa de download de uma URL que falhou. Limpa o
 * contador de tentativas (dá ao usuário +1 chance) e re-enfileira.
 * Respeita o mesmo throttle/fila do `getMediaObjectUrl`.
 *
 * Retorna false se já esgotou o limite de tentativas e não há como retentar
 * (neste caso a UI deve mostrar o placeholder final "Mídia indisponível").
 */
export function retryMedia(url: string): Promise<string> {
  // Se já está em cache (ex.: outra aba baixou), retorna imediatamente.
  const cached = cache.get(url)
  if (cached) {
    refCount.set(cached, (refCount.get(cached) || 0) + 1)
    return Promise.resolve(cached)
  }
  const existing = inflight.get(url)
  if (existing) return existing

  // Reseta o contador de tentativas para permitir +1 ciclo.
  attempts.set(url, 0)
  attempts.set(url, (attempts.get(url) || 0) + 1)
  const p = enqueue(url)
  inflight.set(url, p)
  return p
}

/** Retorna true se a URL ainda pode ser retentada nesta sessão. */
export function canRetryMedia(url: string): boolean {
  return (attempts.get(url) || 0) < MAX_ATTEMPTS
}

/**
 * Baixa o blob de uma mídia e devolve o Blob diretamente (para casos onde
 * se quer um File para download via anchor, sem object URL persistente).
 * Usa o mesmo throttle/fila do `getMediaObjectUrl`.
 */
export async function getMediaBlob(url: string): Promise<Blob> {
  const objectUrl = await getMediaObjectUrl(url)
  try {
    const res = await fetch(objectUrl)
    return await res.blob()
  } finally {
    releaseMediaObjectUrl(url)
  }
}
