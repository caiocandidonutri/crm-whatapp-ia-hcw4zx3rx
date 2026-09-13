import { useState, useEffect } from 'react'
import { RefreshCw, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WhatsappInstance } from '@/types/models'

const RECOVERY_WINDOW_SEC = 6 * 60

function parseDateToSecs(dateStr?: string): number {
  if (!dateStr) return 0
  try {
    const normalized = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr
    const d = new Date(normalized)
    const secs = Math.floor(d.getTime() / 1000)
    return isNaN(secs) ? 0 : secs
  } catch {
    return 0
  }
}

export function AutoRecoveryNotice({ instance }: { instance: WhatsappInstance | null }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  if (!instance || instance.status !== 'connected') return null

  const nowSecs = Math.floor(Date.now() / 1000)
  const restartSecs = parseDateToSecs(instance.last_instance_restart_at)
  const webhookSecs = parseDateToSecs(instance.last_webhook_reconfigured_at)

  const sinceRestart = restartSecs > 0 ? nowSecs - restartSecs : Infinity
  const sinceWebhook = webhookSecs > 0 ? nowSecs - webhookSecs : Infinity

  const isRestarting = sinceRestart < RECOVERY_WINDOW_SEC
  const isReconfiguring = !isRestarting && sinceWebhook < RECOVERY_WINDOW_SEC

  if (!isRestarting && !isReconfiguring) return null

  return (
    <div className="shrink-0 px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-800 animate-fade-in">
      {isRestarting ? (
        <span className="inline-flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
          <span>Reiniciando instância automaticamente para restaurar a sincronização…</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Wrench className="w-3 h-3 shrink-0" />
          <span>Reconfigurando webhook automaticamente para restaurar a sincronização…</span>
        </span>
      )}
    </div>
  )
}
