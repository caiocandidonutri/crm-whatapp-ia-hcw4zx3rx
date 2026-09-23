import { useState, useEffect, useCallback } from 'react'
import { Task } from '@/types/models'
import { getTasks } from '@/services/tasks'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()

  const loadTasks = useCallback(async () => {
    if (!user) {
      setTasks([])
      setLoading(false)
      setError(null)
      return
    }
    try {
      const data = await getTasks()
      setTasks(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.debug('[useTasks] Não foi possível carregar tarefas:', err?.message || err)
      }
      // Degradação graciosa: lista vazia e nunca quebra a tela
      setTasks((prev) => (prev.length > 0 ? prev : []))
      setError('Não foi possível carregar as tarefas')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useRealtime<Task>('tasks', (e) => {
    if (!e || !e.record) return
    if (e.action === 'create') {
      setTasks((prev) => [e.record, ...prev])
    } else if (e.action === 'update') {
      setTasks((prev) => prev.map((t) => (t.id === e.record.id ? e.record : t)))
    } else if (e.action === 'delete') {
      setTasks((prev) => prev.filter((t) => t.id !== e.record.id))
    }
  })

  return { tasks, loading, error, loadTasks }
}
