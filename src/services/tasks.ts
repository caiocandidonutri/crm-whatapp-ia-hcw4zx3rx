import pb from '@/lib/pocketbase/client'
import { Task } from '@/types/models'

export const createTask = async (data: Partial<Task>) => {
  return pb.collection('tasks').create<Task>(data, { requestKey: null })
}

export const updateTask = async (id: string, data: Partial<Task>) => {
  return pb.collection('tasks').update<Task>(id, data, { requestKey: null })
}

export function isAnyAbortError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as any
    if (
      e.name === 'AbortError' ||
      e.name === 'CanceledError' ||
      e.code === 20 ||
      e.code === 'ERR_CANCELED'
    ) {
      return true
    }
    if (e.isAbort === true) return true
    if (e.status === 0 || e.statusCode === 0) return true
    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
    if (
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('signal is aborted') ||
      msg.includes('autocancelled') ||
      msg.includes('canceled') ||
      msg.includes('cancelled') ||
      msg.includes('user aborted')
    ) {
      return true
    }
    if (e.originalError && isAnyAbortError(e.originalError)) return true
    if (e.cause && isAnyAbortError(e.cause)) return true
  }
  return false
}

export interface GetTasksOptions {
  filter?: string
  signal?: AbortSignal
  perPage?: number
  limit?: number
  accountId?: string
}

export const getTasks = async (filterOrOptions?: string | GetTasksOptions): Promise<Task[]> => {
  const options: GetTasksOptions =
    typeof filterOrOptions === 'string' ? { filter: filterOrOptions } : filterOrOptions || {}

  const { filter, signal, accountId, limit } = options

  // Se o signal já chegou cancelado, retorna vazio imediatamente
  if (signal?.aborted) {
    return []
  }

  // Prepara controller interno de timeout caso nenhum signal tenha sido fornecido
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let effectiveSignal = signal

  if (!effectiveSignal) {
    const controller = new AbortController()
    timeoutId = setTimeout(() => controller.abort(), 10000) // 10s de proteção contra timeout de 30s+
    effectiveSignal = controller.signal
  }

  // Monta filtro composto garantindo account_id se fornecido
  let finalFilter = filter || ''
  if (accountId) {
    const accClause = `account_id = "${accountId}"`
    finalFilter = finalFilter ? `(${finalFilter}) && ${accClause}` : accClause
  }

  try {
    // 1ª Tentativa: busca com paginação razoável (ou getList se limitado) com expand
    if (signal?.aborted || effectiveSignal.aborted) return []

    // Usar getList(1, limit || 200) evita travar o SQLite com 1000+ linhas
    const maxItems = limit && limit > 0 ? limit : 300
    const res = await pb.collection('tasks').getList<Task>(1, maxItems, {
      sort: '-created',
      filter: finalFilter || undefined,
      expand: 'assigned_to,crm_contact_id,conversation_id',
      signal: effectiveSignal,
      requestKey: null,
    })

    if (signal?.aborted || effectiveSignal.aborted) return []
    return Array.isArray(res?.items) ? res.items : []
  } catch (err: any) {
    if (signal?.aborted || effectiveSignal.aborted || isAnyAbortError(err)) {
      return []
    }

    // 2ª Tentativa: fallback sem expand (caso haja relação quebrada ou 400)
    try {
      if (import.meta.env.DEV) {
        console.debug(
          '[getTasks] Falha na consulta de tarefas com expand (tentando sem expand):',
          err?.message || err,
        )
      }
      if (signal?.aborted || effectiveSignal.aborted) return []

      const maxItems = limit && limit > 0 ? limit : 300
      const res = await pb.collection('tasks').getList<Task>(1, maxItems, {
        sort: '-created',
        filter: finalFilter || undefined,
        signal: effectiveSignal,
        requestKey: null,
      })

      if (signal?.aborted || effectiveSignal.aborted) return []
      return Array.isArray(res?.items) ? res.items : []
    } catch (fallbackErr: any) {
      if (signal?.aborted || effectiveSignal.aborted || isAnyAbortError(fallbackErr)) {
        return []
      }

      // Em qualquer falha (400, 500, timeout, etc.), NUNCA lança para não derrubar a tela no ErrorBoundary
      console.warn(
        '[getTasks] Falha completa ao carregar tarefas (retornando lista vazia de fallback):',
        fallbackErr?.message || fallbackErr,
      )
      return []
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export const deleteTask = async (id: string) => {
  return pb.collection('tasks').delete(id, { requestKey: null })
}
