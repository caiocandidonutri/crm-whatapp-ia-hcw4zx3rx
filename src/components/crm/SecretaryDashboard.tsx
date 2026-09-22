import { useState, useEffect, useCallback, useRef } from 'react'
import { UserCheck, Clock, AlertTriangle, Heart, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/use-realtime'
import { getCareDashboard, type CareDashboardData } from '@/services/crm_care_service'
import { useNavigate } from 'react-router-dom'

interface SecretaryDashboardProps {
  accountId?: string
}

export function SecretaryDashboard({ accountId }: SecretaryDashboardProps) {
  const navigate = useNavigate()
  const [data, setData] = useState<CareDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!accountId) {
        setLoading(false)
        return
      }
      setError(false)
      try {
        const res = await getCareDashboard(signal)
        if (signal?.aborted) return
        setData(res)
      } catch (err) {
        // Ignora AbortError / cancelamentos silenciosamente
        if (signal?.aborted) return
        console.debug('[SecretaryDashboard] Erro silencioso ao carregar dashboard:', err)
        setError(true)
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    [accountId],
  )

  useEffect(() => {
    // Aborta chamada anterior ao desmontar ou re-executar efeito
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [load])

  useRealtime(
    'crm_contacts',
    () => {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        load(abortControllerRef.current.signal)
      } else {
        load()
      }
    },
    !!accountId,
  )

  useRealtime(
    'tasks',
    () => {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        load(abortControllerRef.current.signal)
      } else {
        load()
      }
    },
    !!accountId,
  )

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-3 bg-muted/40 rounded-xl border border-border/40 text-xs text-muted-foreground flex items-center justify-between">
        <span>Não foi possível carregar as métricas de cuidado no momento.</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs font-medium"
          onClick={() => load()}
        >
          Tentar novamente
        </Button>
      </div>
    )
  }

  if (!data) return null

  const careAlerts = Array.isArray(data?.care_alerts) ? data.care_alerts : []

  const cards = [
    {
      label: 'Atendidos hoje',
      value: data?.attended_today ?? 0,
      icon: UserCheck,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Precisam retorno',
      value: data?.needs_return ?? 0,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      label: 'Tarefas pendentes',
      value: data?.pending_tasks ?? 0,
      icon: AlertTriangle,
      color: 'text-rose-600',
      bg: 'bg-rose-50',
    },
    {
      label: 'Total de pacientes',
      value: data?.total_patients ?? 0,
      icon: Heart,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <Card
            key={card.label}
            className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-xl"
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  card.bg,
                )}
              >
                <card.icon className={cn('w-4 h-4', card.color)} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-xl font-serif font-bold text-primary leading-tight">
                  {card.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {careAlerts.length > 0 && (
        <Card className="border-amber-200/60 shadow-sm bg-amber-50/30 backdrop-blur-sm rounded-xl">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-900">Alertas de cuidado</span>
              <Badge
                variant="secondary"
                className="text-[10px] bg-amber-200 text-amber-800 border-0 ml-auto"
              >
                {careAlerts.length}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {careAlerts.slice(0, 8).map((alert) => (
                <button
                  key={alert.id || alert.name}
                  onClick={() => alert.id && navigate(`/crm?contact=${alert.id}`)}
                  className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-amber-100/60 transition-colors w-full"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate block">
                      {alert.name || 'Contato'}
                    </span>
                    {alert.ai_suggested_action && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {alert.ai_suggested_action}
                      </span>
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] border-0 shrink-0',
                      alert.care_status === 'precisa_retorno'
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-rose-200 text-rose-800',
                    )}
                  >
                    {alert.care_status === 'precisa_retorno' ? 'Retorno' : 'Sem contato'}
                  </Badge>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
