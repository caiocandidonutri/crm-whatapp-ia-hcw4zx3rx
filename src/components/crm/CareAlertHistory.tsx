import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/use-realtime'
import { getCareAlerts } from '@/services/care_alerts_service'
import type { CareAlert } from '@/types/models'

interface CareAlertHistoryProps {
  accountId: string
}

export function CareAlertHistory({ accountId }: CareAlertHistoryProps) {
  const [alerts, setAlerts] = useState<CareAlert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getCareAlerts(accountId, 30)
      setAlerts(data)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  useRealtime('care_alerts', () => load(), !!accountId)

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
        Nenhum alerta enviado ainda
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">Histórico</h3>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {alerts.map((alert) => (
          <div key={alert.id} className="border border-border/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  'text-[10px] border-0',
                  alert.type === 'followup'
                    ? 'bg-blue-100 text-blue-700'
                    : alert.type === 'confirmacao_24h'
                      ? 'bg-teal-100 text-teal-700'
                      : 'bg-amber-100 text-amber-700',
                )}
              >
                {alert.type === 'followup'
                  ? 'Follow-up'
                  : alert.type === 'confirmacao_24h'
                    ? 'Confirmação 24h'
                    : 'Precisa de cuidado'}
              </Badge>
              <div className="flex items-center gap-1 shrink-0">
                {alert.status === 'sent' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                )}
                {alert.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                {alert.status === 'pending' && (
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(alert.created).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                  })}
                </span>
              </div>
            </div>
            {alert.expand?.crm_contact_id && (
              <p className="text-xs font-medium text-foreground">
                {alert.expand.crm_contact_id.contact_name ||
                  alert.expand.crm_contact_id.push_name ||
                  'Paciente'}
              </p>
            )}
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
              {alert.message}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
