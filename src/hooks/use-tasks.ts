import { useState, useEffect, useCallback, useRef } from 'react'
import { Task } from '@/types/models'
import { isAnyAbortError } from '@/services/tasks'
import { safePbFullListWithStatus } from '@/lib/pocketbase/resilient'
import { getErrorMessage } from '@/lib/pocketbase/errors'
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
    setLoading(true)

    try {
      const filter = accountId ? `account_id = "${accountId}"` : undefined
      const res = await safePbFullListWithStatus<Task>({
        collection: 'tasks',
        filter,
        sort: '-created',
        expand: 'assigned_to,crm_contact_id',
        perPage: 100,
        signal: controller.signal,
        label: 'useTasks',
      })

      if (controller.signal.aborted || !isMountedRef.current) return

      if (res.failed) {
        const msg = res.error
          ? getErrorMessage(res.error)
          : 'Houve uma falha ao conectar ao banco de dados.'
        setError(msg)
        // NUNCA sobreescreve com vazio se já tínhamos dados, ou mantém vazio com error
        if (isMountedRef.current) {
          setTasks((prev) => (Array.isArray(prev) ? prev : []))
        }
        return
      }

      setTasks(res.items)
      setError(null)
    } catch (err: any) {
      if (controller.signal.aborted || !isMountedRef.current || isAnyAbortError(err)) {
        return
      }

      if (import.meta.env.DEV) {
        console.debug('[useTasks] Não foi possível carregar tarefas:', err?.message || err)
      }
      if (isMountedRef.current) {
        setError(getErrorMessage(err))
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
