import pb from '@/lib/pocketbase/client'
import { isRateLimitError, parseRetryAfterMs, isNetworkError } from '@/lib/pocketbase/errors'

export interface SafeQueryOptions<T> {
  label?: string
  fallback: T
  timeoutMs?: number
  maxRetries?: number
  signal?: AbortSignal
}

/**
 * Executa uma consulta PocketBase resiliente:
 * - Respeita o cabeçalho retry-after com no máximo 1 retry (ou `maxRetries`, padrão: 1).
 * - Aplica timeout de proteção (padrão: 8000ms).
 * - Em falha persistente (429, 400, rede, timeout, etc.), retorna `fallback` silencioso.
 * - NUNCA lança rejeição.
 */
export async function safePbQuery<T>(
  queryFn: () => Promise<T>,
  options: SafeQueryOptions<T>,
): Promise<T> {
  const { label = 'pb_query', fallback, timeoutMs = 8000, maxRetries = 1, signal } = options

  if (signal?.aborted) {
    return fallback
  }

  const runWithTimeout = async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Timeout na consulta ${label} (${timeoutMs}ms)`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([queryFn(), timeoutPromise])
      if (timer) clearTimeout(timer)
      return result
    } catch (err) {
      if (timer) clearTimeout(timer)
      throw err
    }
  }

  let attempt = 0
  while (attempt <= maxRetries) {
    if (signal?.aborted) return fallback

    try {
      const res = await runWithTimeout()
      return res
    } catch (err: unknown) {
      attempt++
      const is429 = isRateLimitError(err)

      if (is429 && attempt <= maxRetries && !signal?.aborted) {
        const waitMs = parseRetryAfterMs(err, 1200)
        if (import.meta.env.DEV) {
          console.warn(
            `[safePbQuery] HTTP 429 em "${label}". Aguardando ${waitMs}ms para retry (${attempt}/${maxRetries})...`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }

      if (import.meta.env.DEV) {
        const kind = is429 ? '429_rate_limit' : isNetworkError(err) ? 'rede' : 'erro'
        console.warn(
          `[safePbQuery] Falha silenciosa (${kind}) em "${label}". Usando fallback:`,
          (err as any)?.message || err,
        )
      }
      return fallback
    }
  }

  return fallback
}

export interface SafeFullListOptions<T> {
  collection: string
  filter?: string
  sort?: string
  fields?: string
  expand?: string
  perPage?: number
  timeoutMs?: number
  maxRetries?: number
  signal?: AbortSignal
  label?: string
}

/**
 * Wrapper resiliente para carregar listas completas (ou paginadas escalonadas) de uma coleção:
 * - Reduz o perPage padrão para 200 (em vez de rajadas de 1000).
 * - Aplica timeout, retry para 429 e fallback silencioso (lista vazia []).
 * - NUNCA lança rejeição.
 */
export async function safePbFullList<T>(options: SafeFullListOptions<T>): Promise<T[]> {
  const {
    collection,
    filter,
    sort,
    fields,
    expand,
    perPage = 200,
    timeoutMs = 8000,
    maxRetries = 1,
    signal,
    label = `fullList(${collection})`,
  } = options

  return safePbQuery<T[]>(
    async () => {
      if (signal?.aborted) return []
      const res = await pb.collection(collection).getFullList<T>({
        batch: perPage,
        filter: filter || undefined,
        sort: sort || undefined,
        fields: fields || undefined,
        expand: expand || undefined,
        requestKey: null,
      })
      return Array.isArray(res) ? res : []
    },
    {
      label,
      fallback: [],
      timeoutMs,
      maxRetries,
      signal,
    },
  )
}

/**
 * Escalonamento com delay (jitter) para evitar disparo síncrono em massa no mount.
 */
export function sleepStaggered(index: number, stepMs = 60): Promise<void> {
  const delay = index * stepMs
  if (delay <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delay))
}
