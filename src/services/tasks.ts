import pb from '@/lib/pocketbase/client'
import { Task } from '@/types/models'

export const createTask = async (data: Partial<Task>) => {
  return pb.collection('tasks').create<Task>(data, { requestKey: null })
}

export const updateTask = async (id: string, data: Partial<Task>) => {
  return pb.collection('tasks').update<Task>(id, data, { requestKey: null })
}

export const getTasks = async (filter?: string) => {
  try {
    return await pb.collection('tasks').getFullList<Task>({
      sort: '-created',
      filter: filter || undefined,
      expand: 'assigned_to,crm_contact_id,conversation_id',
      requestKey: null,
    })
  } catch (err: any) {
    // Se a query falhar com 400 por erro em expand/relation órfã, tenta fallback sem expand
    if (err?.status === 400) {
      if (import.meta.env.DEV) {
        console.debug('[getTasks] Fallback sem expand acionado após erro 400:', err?.message || err)
      }
      return await pb.collection('tasks').getFullList<Task>({
        sort: '-created',
        filter: filter || undefined,
        requestKey: null,
      })
    }
    throw err
  }
}

export const deleteTask = async (id: string) => {
  return pb.collection('tasks').delete(id, { requestKey: null })
}
