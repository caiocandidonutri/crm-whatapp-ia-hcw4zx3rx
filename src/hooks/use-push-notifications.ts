import { useState, useEffect, useCallback } from 'react'
import { useRealtime } from '@/hooks/use-realtime'

const STORAGE_KEY = 'push-permission-dismissed'

export function usePushNotifications(enabled: boolean = true) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let dismissed = false
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      // ignore
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default' &&
      !dismissed
    ) {
      setShowBanner(true)
    }
  }, [enabled])

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      setShowBanner(false)
    } catch {
      // ignore
    }
  }, [])

  const dismissBanner = useCallback(() => {
    setShowBanner(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
  }, [])

  useRealtime(
    'notifications',
    (e) => {
      if (e.action !== 'create') return
      const rec = e.record as any
      if (rec.read) return
      if (permission !== 'granted') return
      if (typeof document !== 'undefined' && !document.hidden) return
      try {
        const n = new Notification(rec.title || 'Nova notificação', {
          body: rec.body || undefined,
          tag: rec.id,
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
      } catch {
        // ignore
      }
    },
    enabled && permission === 'granted',
  )

  return { permission, showBanner, requestPermission, dismissBanner }
}
