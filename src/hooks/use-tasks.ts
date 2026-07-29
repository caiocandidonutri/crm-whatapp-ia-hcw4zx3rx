import { useState, useEffect, useCallback } from 'react'
import { Task } from '@/types/models'
import { getTasks } from '@/services/tasks'
import { useRealtime } from '@/hooks/use-realtime'
import { useAuth } from '@/hooks/use-auth'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuth()

  const loadTasks = useCallback(async () => {
    if (!user) return
    try {
      const data = await getTasks()
      setTasks(data)
    } catch (err) {
      console.error('Failed to fetch tasks', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useRealtime<Task>('tasks', (e) => {
    if (e.action === 'create') {
      setTasks((prev) => [e.record, ...prev])
    } else if (e.action === 'update') {
      setTasks((prev) => prev.map((t) => (t.id === e.record.id ? e.record : t)))
    } else if (e.action === 'delete') {
      setTasks((prev) => prev.filter((t) => t.id !== e.record.id))
    }
  })

  return { tasks, loading, loadTasks }
}
