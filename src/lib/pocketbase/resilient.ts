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
  pageTimeoutMs?: number
  throwOnError?: boolean
}

export interface SafeFullListResult<T> {
  items: T[]
  failed: boolean
  error?: unknown
}

/**
 * Carrega todos os registros de uma coleção com paginação iterativa:
 * - Aplica timeout POR PÁGINA (padrão: 8000ms por página).
 * - Aplica retry com respeito ao cabeçalho Retry-After em HTTP 429 por página.
 * - Retorna { items, failed, error? } indicando explicitamente se a busca falhou
 *   (ex: 403, 429 persistente, timeout, erro de rede).
 */
export async function safePbFullListWithStatus<T>(
  options: SafeFullListOptions<T>,
): Promise<SafeFullListResult<T>> {
  const {
    collection,
    filter,
    sort,
    fields,
    expand,
    perPage = 200,
    timeoutMs = 8000,
    pageTimeoutMs,
    maxRetries = 1,
    signal,
    label = `fullList(${collection})`,
  } = options

  const effectivePageTimeout = pageTimeoutMs || timeoutMs
  const allItems: T[] = []
  let page = 1
  let totalPages = 1

  if (signal?.aborted) {
    return { items: [], failed: false }
  }

  try {
    do {
      if (signal?.aborted) {
        return { items: allItems, failed: false }
      }

      const fetchPageWithRetry = async (): Promise<{ items: T[]; totalPages: number }> => {
        let attempt = 0
        while (attempt <= maxRetries) {
          if (signal?.aborted) return { items: [], totalPages: 0 }

          let timer: ReturnType<typeof setTimeout> | null = null
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Timeout na página ${page} de ${label} (${effectivePageTimeout}ms)`))
            }, effectivePageTimeout)
          })

          try {
            const pagePromise = pb.collection(collection).getList<T>(page, perPage, {
              filter: filter || undefined,
              sort: sort || undefined,
              fields: fields || undefined,
              expand: expand || undefined,
              requestKey: null,
            })

            const res = await Promise.race([pagePromise, timeoutPromise])
            if (timer) clearTimeout(timer)
            return {
              items: Array.isArray(res?.items) ? res.items : [],
              totalPages: Number.isFinite(res?.totalPages) ? res.totalPages : 1,
            }
          } catch (err: unknown) {
            if (timer) clearTimeout(timer)
            attempt++
            const is429 = isRateLimitError(err)

            if (is429 && attempt <= maxRetries && !signal?.aborted) {
              const waitMs = parseRetryAfterMs(err, 1200)
              if (import.meta.env.DEV) {
                console.warn(
                  `[safePbFullList] HTTP 429 na página ${page} de "${label}". Aguardando ${waitMs}ms (${attempt}/${maxRetries})...`,
                )
              }
              await new Promise((resolve) => setTimeout(resolve, waitMs))
              continue
            }

            // Erro final para esta página (não-429 ou retries esgotados)
            throw err
          }
        }
        throw new Error(`Falha após ${maxRetries} tentativas na página ${page} de ${label}`)
      }

      const pageRes = await fetchPageWithRetry()
      allItems.push(...pageRes.items)
      totalPages = pageRes.totalPages
      page++
    } while (page <= totalPages)

    return { items: allItems, failed: false }
  } catch (err: unknown) {
    if (signal?.aborted) {
      return { items: allItems, failed: false }
    }
    if (import.meta.env.DEV) {
      console.warn(`[safePbFullList] Falha na busca de "${label}":`, (err as any)?.message || err)
    }
    return { items: allItems, failed: true, error: err }
  }
}

/**
 * Wrapper resiliente para carregar listas completas:
 * - Aplica timeout POR PÁGINA e retry em HTTP 429.
 * - Suporta `throwOnError: true` para lançar erro em vez de engolir falha.
 * - Mantém compatibilidade com chamadores antigos retornando array T[].
 */
export async function safePbFullList<T>(options: SafeFullListOptions<T>): Promise<T[]> {
  const result = await safePbFullListWithStatus<T>(options)
  if (result.failed && options.throwOnError) {
    const errorToThrow =
      result.error || new Error(`Falha ao carregar ${options.label || options.collection}`)
    throw errorToThrow
  }
  return result.items
}

/**
 * Escalonamento com delay (jitter) para evitar disparo síncrono em massa no mount.
 */
export function sleepStaggered(index: number, stepMs = 60): Promise<void> {
  const delay = index * stepMs
  if (delay <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delay))
}
