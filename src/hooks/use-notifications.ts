import { useState, useEffect, useCallback } from 'react'
import { useRealtime } from '@/hooks/use-realtime'
import { Notification } from '@/types/models'
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/services/notifications'

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [result, count] = await Promise.all([
        getNotifications(1, 30),
        getUnreadNotificationCount(),
      ])
      setNotifications(result.items)
      setUnreadCount(count)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useRealtime<Notification>('notifications', (e) => {
    if (e.action === 'create') {
      setNotifications((prev) => [e.record, ...prev].slice(0, 50))
      if (!e.record.read) setUnreadCount((c) => c + 1)
    } else if (e.action === 'update') {
      const prevNotif = notifications.find((n) => n.id === e.record.id)
      const wasUnread = prevNotif ? !prevNotif.read : false
      const isUnread = !e.record.read
      setNotifications((prev) => prev.map((n) => (n.id === e.record.id ? e.record : n)))
      if (wasUnread && !isUnread) setUnreadCount((c) => Math.max(0, c - 1))
      if (!wasUnread && isUnread) setUnreadCount((c) => c + 1)
    } else if (e.action === 'delete') {
      const prevNotif = notifications.find((n) => n.id === e.record.id)
      const wasUnread = prevNotif ? !prevNotif.read : false
      setNotifications((prev) => prev.filter((n) => n.id !== e.record.id))
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1))
    }
  })

  const markAsRead = useCallback(async (id: string) => {
    try {
      await markNotificationAsRead(id)
      setNotifications((prev) => {
        const n = prev.find((x) => x.id === id)
        if (n && !n.read) setUnreadCount((c) => Math.max(0, c - 1))
        return prev.map((x) => (x.id === id ? { ...x, read: true } : x))
      })
    } catch {
      // ignore
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    try {
      await markAllNotificationsAsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {
      // ignore
    }
  }, [])

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, reload: load }
}
