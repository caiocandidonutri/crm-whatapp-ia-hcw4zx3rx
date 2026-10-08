import { useState, useEffect, useCallback, useRef } from 'react'
import { Task } from '@/types/models'
import { getTasks } from '@/services/tasks'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()
  const { accountId } = useCurrentAccount()
  const activeControllerRef = useRef<AbortController | null>(null)

  const loadTasks = useCallback(async () => {
    if (!user) {
      setTasks([])
      setLoading(false)
      setError(null)
      return
    }

    // Cancela requisição anterior em andamento
    if (activeControllerRef.current) {
      activeControllerRef.current.abort()
    }
    const controller = new AbortController()
    activeControllerRef.current = controller

    try {
      const data = await getTasks({
        accountId: accountId || undefined,
        signal: controller.signal,
        limit: 300,
      })

      if (controller.signal.aborted) return

      const safeList = Array.isArray(data) ? data : []
      setTasks(safeList)
      setError(null)
    } catch (err: any) {
      if (controller.signal.aborted) return

      if (import.meta.env.DEV) {
        console.debug('[useTasks] Não foi possível carregar tarefas:', err?.message || err)
      }
      // Degradação graciosa: lista vazia e nunca quebra a tela
      setTasks((prev) => (Array.isArray(prev) ? prev : []))
      setError('Não foi possível carregar as tarefas')
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [user, accountId])

  useEffect(() => {
    loadTasks()
    return () => {
      if (activeControllerRef.current) {
        activeControllerRef.current.abort()
      }
    }
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
