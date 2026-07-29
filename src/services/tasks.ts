import pb from '@/lib/pocketbase/client'
import { Task } from '@/types/models'

export const createTask = async (data: Partial<Task>) => {
  return pb.collection('tasks').create<Task>(data, { requestKey: null })
}

export const updateTask = async (id: string, data: Partial<Task>) => {
  return pb.collection('tasks').update<Task>(id, data, { requestKey: null })
}

export const getTasks = async (filter?: string) => {
  return pb.collection('tasks').getFullList<Task>({
    sort: '-created',
    filter,
    expand: 'assigned_to',
    requestKey: null,
  })
}

export const deleteTask = async (id: string) => {
  return pb.collection('tasks').delete(id, { requestKey: null })
}
