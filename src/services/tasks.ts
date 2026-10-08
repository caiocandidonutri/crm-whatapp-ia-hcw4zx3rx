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

  const maxItems = limit && limit > 0 ? limit : 300

  try {
    if (signal?.aborted || effectiveSignal.aborted) return []

    // 1ª Tentativa: expand apenas de relações leves e comprovadamente válidas (assigned_to, crm_contact_id).
    // O expand de conversation_id é pesado e causa HTTP 400 / timeout em bases com muitas mensagens/conversas.
    let items: Task[] = []
    try {
      const res = await pb.collection('tasks').getList<Task>(1, maxItems, {
        sort: '-created',
        filter: finalFilter || undefined,
        expand: 'assigned_to,crm_contact_id',
        signal: effectiveSignal,
        requestKey: null,
      })
      if (signal?.aborted || effectiveSignal.aborted) return []
      items = Array.isArray(res?.items) ? res.items : []
    } catch (expandErr: any) {
      if (signal?.aborted || effectiveSignal.aborted || isAnyAbortError(expandErr)) {
        return []
      }
      if (import.meta.env.DEV) {
        console.debug(
          '[getTasks] Falha na consulta de tarefas com expand (tentando sem expand):',
          expandErr?.message || expandErr,
        )
      }

      // 2ª Tentativa: fallback totalmente sem expand
      const fallbackRes = await pb.collection('tasks').getList<Task>(1, maxItems, {
        sort: '-created',
        filter: finalFilter || undefined,
        signal: effectiveSignal,
        requestKey: null,
      })
      if (signal?.aborted || effectiveSignal.aborted) return []
      items = Array.isArray(fallbackRes?.items) ? fallbackRes.items : []
    }

    return Array.isArray(items) ? items : []
  } catch (err: any) {
    if (signal?.aborted || effectiveSignal.aborted || isAnyAbortError(err)) {
      return []
    }

    // Em qualquer falha (400, 500, timeout, etc.), NUNCA lança para não derrubar a tela no ErrorBoundary
    console.warn(
      '[getTasks] Falha completa ao carregar tarefas (retornando lista vazia de fallback):',
      err?.message || err,
    )
    return []
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export const deleteTask = async (id: string) => {
  return pb.collection('tasks').delete(id, { requestKey: null })
}
