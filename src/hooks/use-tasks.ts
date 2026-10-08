import { useState, useEffect, useCallback, useRef } from 'react'
import { Task } from '@/types/models'
import { getTasks, isAnyAbortError } from '@/services/tasks'
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
  const isMountedRef = useRef<boolean>(true)

  const loadTasks = useCallback(async () => {
    if (!user) {
      if (isMountedRef.current) {
        setTasks([])
        setLoading(false)
        setError(null)
      }
      return
    }

    // Cancela requisição anterior em andamento
    if (activeControllerRef.current) {
      try {
        activeControllerRef.current.abort()
      } catch {
        // Ignora qualquer erro no abort
      }
    }
    const controller = new AbortController()
    activeControllerRef.current = controller

    try {
      const data = await getTasks({
        accountId: accountId || undefined,
        signal: controller.signal,
        limit: 300,
      }).catch((tasksErr) => {
        // Proteção extra: nenhum erro/rejeição deve escapar de getTasks
        if (isAnyAbortError(tasksErr) || controller.signal.aborted) {
          return []
        }
        if (import.meta.env.DEV) {
          console.debug('[useTasks] getTasks rejection swallowed:', tasksErr?.message || tasksErr)
        }
        return []
      })

      if (controller.signal.aborted || !isMountedRef.current) return

      const safeList = Array.isArray(data) ? data : []
      setTasks(safeList)
      setError(null)
    } catch (err: any) {
      if (controller.signal.aborted || !isMountedRef.current || isAnyAbortError(err)) {
        return
      }

      if (import.meta.env.DEV) {
        console.debug('[useTasks] Não foi possível carregar tarefas:', err?.message || err)
      }
      // Degradação graciosa: lista vazia e nunca quebra a tela
      if (isMountedRef.current) {
        setTasks((prev) => (Array.isArray(prev) ? prev : []))
        setError('Não foi possível carregar as tarefas')
      }
    } finally {
      if (!controller.signal.aborted && isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [user, accountId])

  useEffect(() => {
    isMountedRef.current = true
    loadTasks().catch(() => {
      // Proteção absoluta contra qualquer unhandled rejection
    })
    return () => {
      isMountedRef.current = false
      if (activeControllerRef.current) {
        try {
          activeControllerRef.current.abort()
        } catch {
          // Ignora
        }
      }
    }
  }, [loadTasks])

  useRealtime<Task>('tasks', (e) => {
    try {
      if (!e || !e.record) return
      if (e.action === 'create') {
        setTasks((prev) => (Array.isArray(prev) ? [e.record, ...prev] : [e.record]))
      } else if (e.action === 'update') {
        setTasks((prev) =>
          Array.isArray(prev) ? prev.map((t) => (t.id === e.record.id ? e.record : t)) : [],
        )
      } else if (e.action === 'delete') {
        setTasks((prev) => (Array.isArray(prev) ? prev.filter((t) => t.id !== e.record.id) : []))
      }
    } catch {
      // Ignora erro de realtime para nunca derrubar a tela
    }
  })

  return { tasks, loading, error, loadTasks }
}
