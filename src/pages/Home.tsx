import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  UserPlus,
  ChevronRight,
  Camera,
  BarChart3,
  Video,
  FileText,
  AudioLines,
  ListTodo,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  HeartHandshake,
  Mic,
  ArrowRight,
  Sparkles,
  Users,
  Calendar,
  TrendingUp,
  AlertCircle,
  Activity,
  ShieldCheck,
  Inbox,
  CalendarClock,
  Timer,
  ShieldAlert,
  DollarSign,
  LayoutDashboard,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useTeamMembers } from '@/hooks/use-team-members'
import { useInstanciaAtiva, useConversas } from '@/hooks/use-whatsapp'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { useTasks } from '@/hooks/use-tasks'
import { getPriorityMeta, CARE_CATEGORIES } from '@/lib/task-meta'
import { stageStyle } from '@/lib/stage-colors'
import { FollowupRecoveryReport } from '@/components/crm/FollowupRecoveryReport'
import { AutomationsControlCard } from '@/components/crm/AutomationsControlCard'
import { getSatisfactionSummary, type SurveySummaryStats } from '@/services/satisfaction_surveys'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TaskViewDialog } from '@/components/TaskViewDialog'
import { consultarStatusInstancia } from '@/services/whatsapp_service'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import {
  fetchHomeMetricsWithStatus,
  HomeMetricsData,
  DEFAULT_HOME_METRICS,
  isAnyAbortError as isHomeAbortError,
} from '@/services/home_metrics'
import {
  formatLongDateSaoPaulo,
  formatRecentActivityDate,
  formatBrazilianDate,
  formatTimeSaoPaulo,
  getDayKeySaoPaulo,
  parseToDate,
} from '@/lib/datetime'
import {
  fetchCommandCenterMetrics,
  DEFAULT_COMMAND_CENTER_METRICS,
  type CommandCenterMetrics,
} from '@/services/command_center'
export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { accountId } = useCurrentAccount()
  const { instance } = useInstanciaAtiva()
  const { conversations } = useConversas(instance?.instance_name)
  const { tasks, error: tasksError } = useTasks()

  const [metrics, setMetrics] = useState<HomeMetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backendRestarting, setBackendRestarting] = useState(false)
  const [autoRetryCount, setAutoRetryCount] = useState(0)

  const { members: rawTeamMembers } = useTeamMembers()
  const teamMembers = useMemo(() => {
    if (!Array.isArray(rawTeamMembers)) return []
    return rawTeamMembers
      .map((m) => m?.expand?.user_id)
      .filter((u): u is NonNullable<typeof u> => Boolean(u && typeof u === 'object'))
  }, [rawTeamMembers])

  const [selectedTask, setSelectedTask] = useState<any | null>(null)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [statusCheckFailed, setStatusCheckFailed] = useState(false)
  const [statusWarningDismissed, setStatusWarningDismissed] = useState(false)

  const checkInstanceStatus = useCallback(async () => {
    if (!instance?.instance_name) return
    setStatusWarningDismissed(false)
    const res = await consultarStatusInstancia(instance.instance_name)
    setStatusCheckFailed(!!res.error)
  }, [instance?.instance_name])

  useEffect(() => {
    if (instance?.instance_name && instance?.status === 'connected') {
      checkInstanceStatus()
    } else {
      setStatusCheckFailed(false)
      setStatusWarningDismissed(false)
    }
  }, [instance?.instance_name, instance?.status, checkInstanceStatus])

  const [sessionExpired, setSessionExpired] = useState(false)
  const [surveyStats, setSurveyStats] = useState<SurveySummaryStats | null>(null)

  // ═══ Painel de Comando (X-ray): métricas leves e resilientes ═══
  const [commandCenter, setCommandCenter] = useState<CommandCenterMetrics>(
    DEFAULT_COMMAND_CENTER_METRICS,
  )

  const loadCommandCenter = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetchCommandCenterMetrics(accountId, signal)
        if (signal?.aborted) return
        setCommandCenter(res)
      } catch {
        // Proteção absoluta: qualquer falha mantém os valores silenciosos (null/0)
        if (!signal?.aborted) {
          setCommandCenter(DEFAULT_COMMAND_CENTER_METRICS)
        }
      }
    },
    [accountId],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadCommandCenter(controller.signal).catch(() => {
      // Nenhum rejection escapa: a /home nunca pode cair por causa deste cartão
    })
    return () => {
      try {
        controller.abort()
      } catch {
        // Ignora (AbortError ao desmontar é inofensivo)
      }
    }
  }, [loadCommandCenter])

  // Recarrega junto com o refresh manual do painel
  const refreshCommandCenter = useCallback(() => {
    loadCommandCenter().catch(() => {
      // Ignora silenciosamente
    })
  }, [loadCommandCenter])

  const loadMetrics = useCallback(
    async (silent = false, signal?: AbortSignal) => {
      if (!silent) {
        setLoading(true)
      } else {
        setIsRefreshing(true)
      }
      setError(null)
      try {
        if (signal?.aborted) return

        const results = await Promise.allSettled([
          (async () => {
            try {
              if (signal?.aborted) return null
              return await fetchHomeMetricsWithStatus(signal, metrics || undefined)
            } catch (metricsCatchErr) {
              if (signal?.aborted) return null
              console.warn(
                '[Home] Erro capturado ao obter métricas (tratando como backend indisponível):',
                metricsCatchErr,
              )
              return { data: metrics || DEFAULT_HOME_METRICS, isBackendUnavailable: true }
            }
          })(),
          (async () => {
            try {
              if (!accountId || signal?.aborted) return null
              return await getSatisfactionSummary(accountId, signal, surveyStats || undefined)
            } catch (surveyCatchErr) {
              if (signal?.aborted) return null
              console.warn(
                '[Home] Erro seguro capturado ao obter pesquisa de satisfação:',
                surveyCatchErr,
              )
              return surveyStats || null
            }
          })(),
        ])
        if (signal?.aborted) return

        const metricsResult = results[0]
        const surveyResult = results[1]

        if (metricsResult?.status === 'fulfilled' && metricsResult.value) {
          const fetchRes = metricsResult.value
          if (fetchRes.isBackendUnavailable) {
            setBackendRestarting(true)
          } else {
            setBackendRestarting(false)
            setAutoRetryCount(0)
            setMetrics(fetchRes.data)
          }
        } else if (metricsResult?.status === 'rejected') {
          console.warn(
            '[Home] Erro em metricsResult de allSettled (ativando retry de backend indisponível):',
            metricsResult.reason,
          )
          setBackendRestarting(true)
        }

        if (surveyResult?.status === 'fulfilled' && surveyResult.value) {
          setSurveyStats(surveyResult.value)
        } else if (surveyResult?.status === 'rejected') {
          console.warn('[Home] Erro em surveyResult de allSettled:', surveyResult.reason)
        }
        setSessionExpired(false)
      } catch (err: any) {
        if (signal?.aborted) {
          // Ignora cancelamentos por desmontagem silenciosamente
          return
        }
        console.error('Failed to load aggregated home metrics:', err)
        const isAuthErr =
          err?.status === 401 || err?.message?.includes('401') || err?.message?.includes('token')
        if (isAuthErr) {
          setSessionExpired(true)
          setError('Sua sessão expirou. Entre novamente para visualizar os dados da clínica.')
          if (!silent) {
            toast({
              title: 'Erro de autenticação',
              description: 'Sua sessão expirou. Entre novamente.',
              variant: 'destructive',
            })
          }
        } else {
          // Em qualquer outra falha (AbortError, HTTP N/A, timeout, rede),
          // NUNCA exibe alerta genérico de erro nem derruba para ErrorBoundary:
          // ativa o estado gracioso de "Servidor reiniciando, tentando de novo..." com auto-retry.
          setBackendRestarting(true)
        }
      } finally {
        if (!signal?.aborted) {
          if (!silent) setLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [toast, metrics],
  )

  useEffect(() => {
    const controller = new AbortController()
    loadMetrics(false, controller.signal).catch(() => {
      // Proteção absoluta contra unhandled rejection
    })
    return () => {
      try {
        controller.abort()
      } catch {
        // Ignora
      }
    }
  }, [loadMetrics])

  // Auto-retry quando servidor estiver reiniciando (502 / rede)
  useEffect(() => {
    if (!backendRestarting) return
    const timer = setTimeout(() => {
      setAutoRetryCount((c) => c + 1)
      loadMetrics(true).catch(() => {})
    }, 4000)
    return () => clearTimeout(timer)
  }, [backendRestarting, loadMetrics, autoRetryCount])

  // Atualização em tempo real das mensagens, conversas, contatos e tarefas
  useRealtime('whatsapp_messages', () => {
    try {
      loadMetrics(true).catch(() => {})
    } catch {
      /* intentionally ignored */
    }
  })
  useRealtime('conversations', () => {
    try {
      loadMetrics(true).catch(() => {})
    } catch {
      /* intentionally ignored */
    }
  })
  useRealtime('tasks', () => {
    try {
      loadMetrics(true).catch(() => {})
    } catch {
      /* intentionally ignored */
    }
  })
  useRealtime('crm_contacts', () => {
    try {
      loadMetrics(true).catch(() => {})
    } catch {
      /* intentionally ignored */
    }
  })

  // Tarefas urgentes do usuário logado com proteção contra undefined
  const pendingTasks = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks : []
    return list.filter((t) => t && t.status !== 'concluida' && t.status !== 'cancelada')
  }, [tasks])

  const myPendingTasks = useMemo(() => {
    return pendingTasks.filter((t) => t.assigned_to === user?.id)
  }, [pendingTasks, user?.id])

  const myUrgentTasks = useMemo(() => {
    const PRIORITY_WEIGHT: Record<string, number> = {
      urgente: 4,
      alta: 3,
      media: 2,
      baixa: 1,
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return [...myPendingTasks].sort((a, b) => {
      const aDue = a.due_date ? new Date(a.due_date) : null
      const bDue = b.due_date ? new Date(b.due_date) : null

      const aOverdue = aDue && aDue < today
      const bOverdue = bDue && bDue < today

      if (aOverdue && !bOverdue) return -1
      if (!aOverdue && bOverdue) return 1

      if (aDue && bDue) {
        if (aDue.getTime() !== bDue.getTime()) return aDue.getTime() - bDue.getTime()
      } else if (aDue && !bDue) {
        return -1
      } else if (!aDue && bDue) {
        return 1
      }

      const aPri = PRIORITY_WEIGHT[a.priority] || 0
      const bPri = PRIORITY_WEIGHT[b.priority] || 0
      return bPri - aPri
    })
  }, [myPendingTasks])

  const myTaskCount = myPendingTasks.length
  const otherTeamTasksCount = pendingTasks.length - myPendingTasks.length

  // ═══ Painel de Comando: derivados de tarefas (cálculo leve no cliente) ═══
  const pendingTasksCount = pendingTasks.length

  const overdueTasksCount = useMemo(() => {
    const nowMs = Date.now()
    const HOUR_MS = 60 * 60 * 1000
    const OVERDUE_MS = 24 * HOUR_MS
    return pendingTasks.filter((t) => {
      const dueMs = t?.due_date ? (parseToDate(t.due_date)?.getTime() ?? null) : null
      if (dueMs && dueMs < nowMs - OVERDUE_MS) return true
      const createdMs = t?.created ? (parseToDate(t.created)?.getTime() ?? null) : null
      return !!(createdMs && createdMs < nowMs - OVERDUE_MS)
    }).length
  }, [pendingTasks])

  let headerTaskText = ''
  if (myTaskCount > 0 || otherTeamTasksCount > 0) {
    if (myTaskCount === 1) {
      headerTaskText = '1 tarefa sua'
    } else if (myTaskCount > 1) {
      headerTaskText = `${myTaskCount} tarefas suas`
    } else {
      headerTaskText = 'Nenhuma tarefa sua'
    }

    if (otherTeamTasksCount > 0) {
      headerTaskText += ` · ${otherTeamTasksCount} da equipe`
    }

    headerTaskText += ' pendentes'
  }

  // Atalhos rápidos
  const shortcuts = [
    {
      title: 'Checklist Recepção',
      description: 'Rotinas operacionais da clínica (Plano Fabiana)',
      icon: ShieldCheck,
      color: 'text-purple-600',
      bg: 'bg-purple-100',
      link: '/recepcao',
    },
    {
      title: 'Abrir Conversas',
      description: 'Acesse seu inbox WhatsApp',
      icon: MessageSquare,
      color: 'text-emerald-600',
      bg: 'bg-emerald-100',
      link: '/conversas',
    },
    {
      title: 'Pipeline CRM',
      description: 'Funil e contatos de pacientes',
      icon: UserPlus,
      color: 'text-blue-600',
      bg: 'bg-blue-100',
      link: '/crm',
    },
    {
      title: 'Tarefas de Cuidado',
      description: 'Gerencie follow-ups e pendências',
      icon: ListTodo,
      color: 'text-amber-600',
      bg: 'bg-amber-100',
      link: '/tarefas',
    },
  ]

  // Conversas recentes do WhatsApp (com blindagem defensiva para array vazio/nulo)
  const recentChats = useMemo(() => {
    const list = Array.isArray(conversations) ? conversations : []
    return [...list]
      .filter((c): c is NonNullable<typeof c> => Boolean(c && typeof c === 'object'))
      .sort((a, b) => {
        const aTs =
          a?.last_message_timestamp && a.last_message_timestamp > 0 ? a.last_message_timestamp : 0
        const bTs =
          b?.last_message_timestamp && b.last_message_timestamp > 0 ? b.last_message_timestamp : 0
        return bTs - aTs
      })
      .slice(0, 5)
  }, [conversations])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'BOM DIA'
    if (hour < 18) return 'BOA TARDE'
    return 'BOA NOITE'
  }

  const formattedDate = (() => {
    try {
      const todayDate = parseToDate(new Date()) || new Date()
      const s = formatLongDateSaoPaulo(todayDate, false) || ''
      if (!s) return 'Hoje'
      return s.charAt(0).toUpperCase() + s.slice(1)
    } catch {
      return 'Hoje'
    }
  })()

  const instanceStatus = instance?.status || 'disconnected'
  const isStatusUnavailable = statusCheckFailed
  const isConnected = !isStatusUnavailable && instanceStatus === 'connected'
  const isConnecting =
    !isStatusUnavailable && (instanceStatus === 'qrcode' || instanceStatus === 'creating')
  const statusColor = backendRestarting
    ? 'bg-amber-500'
    : isStatusUnavailable
      ? 'bg-red-500'
      : isConnected
        ? 'bg-emerald-500'
        : isConnecting
          ? 'bg-amber-500'
          : 'bg-gray-500'
  const statusText = backendRestarting
    ? 'Reconectando...'
    : isStatusUnavailable
      ? 'Indisponível'
      : isConnected
        ? 'Conectado'
        : isConnecting
          ? 'Conectando'
          : 'Desconectado'
  const instanceLabel = instance?.instance_name || 'WhatsApp principal'

  // Dados do gráfico de 7 dias com fallbacks resilientes
  const chartData = useMemo(() => {
    const list = metrics?.chart
    if (!Array.isArray(list)) return []
    return list.map((item) => ({
      ...item,
      total: typeof item?.total === 'number' && !isNaN(item.total) ? item.total : 0,
      received: typeof item?.received === 'number' && !isNaN(item.received) ? item.received : 0,
      sent: typeof item?.sent === 'number' && !isNaN(item.sent) ? item.sent : 0,
      label: item?.label || '',
    }))
  }, [metrics?.chart])

  const maxTotal = useMemo(() => {
    if (!chartData || chartData.length === 0) return 1
    const totals = chartData.map((d) => d.total).filter((n) => typeof n === 'number' && !isNaN(n))
    return Math.max(...totals, 1)
  }, [chartData])

  // Dados do funil com total para cálculo percentual (com blindagens defensivas)
  const funnelStages = useMemo(() => {
    const list = metrics?.funnel
    if (!Array.isArray(list)) return []
    return list.map((stage) => ({
      key: stage?.key || 'outro',
      label: stage?.label || 'Estágio',
      color: stage?.color || 'blue',
      count: typeof stage?.count === 'number' && !isNaN(stage.count) ? stage.count : 0,
    }))
  }, [metrics?.funnel])

  const funnelTotalPatients = useMemo(() => {
    return funnelStages.reduce((acc, stage) => acc + (stage.count || 0), 0)
  }, [funnelStages])

  // Total de pendências de cuidado
  const careCategoryCounts = metrics?.careTasksByCategory || {
    precisa_consulta: 0,
    precisa_atencao: 0,
    nao_respondeu: 0,
    precisa_retorno: 0,
    alta_demanda: 0,
    followup_10_15: 0,
  }

  const totalCarePending = useMemo(() => {
    return Object.values(careCategoryCounts).reduce((acc, cur) => acc + (cur || 0), 0)
  }, [careCategoryCounts])

  // Mapeamento das pendências com metadados
  const careCategoriesList = useMemo(() => {
    const keys: Array<{
      key: keyof typeof careCategoryCounts
      fallbackLabel: string
      fallbackEmoji: string
      fallbackColor: string
      accentClass: string
      badgeClass: string
    }> = [
      {
        key: 'precisa_consulta',
        fallbackLabel: 'Precisa consulta',
        fallbackEmoji: '📅',
        fallbackColor: 'blue',
        accentClass: 'hover:border-blue-400 bg-blue-50/40 text-blue-900',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
      },
      {
        key: 'precisa_atencao',
        fallbackLabel: 'Precisa atenção',
        fallbackEmoji: '⚡',
        fallbackColor: 'violet',
        accentClass: 'hover:border-violet-400 bg-violet-50/40 text-violet-900',
        badgeClass: 'bg-violet-100 text-violet-800 border-violet-200',
      },
      {
        key: 'nao_respondeu',
        fallbackLabel: 'Não respondeu',
        fallbackEmoji: '⏰',
        fallbackColor: 'rose',
        accentClass: 'hover:border-rose-400 bg-rose-50/40 text-rose-900',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
      },
      {
        key: 'precisa_retorno',
        fallbackLabel: 'Precisa retorno',
        fallbackEmoji: '🔄',
        fallbackColor: 'amber',
        accentClass: 'hover:border-amber-400 bg-amber-50/40 text-amber-900',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      },
      {
        key: 'alta_demanda',
        fallbackLabel: 'Alta demanda',
        fallbackEmoji: '🚨',
        fallbackColor: 'orange',
        accentClass: 'hover:border-orange-400 bg-orange-50/40 text-orange-900',
        badgeClass: 'bg-orange-100 text-orange-800 border-orange-200',
      },
      {
        key: 'followup_10_15',
        fallbackLabel: 'Follow-up 10-15 dias',
        fallbackEmoji: '⏳',
        fallbackColor: 'teal',
        accentClass: 'hover:border-teal-400 bg-teal-50/40 text-teal-900',
        badgeClass: 'bg-teal-100 text-teal-800 border-teal-200',
      },
    ]

    return keys.map((item) => {
      const meta = CARE_CATEGORIES.find((c) => c.id === item.key)
      const count = careCategoryCounts[item.key] || 0
      return {
        key: item.key,
        label: meta?.label || item.fallbackLabel,
        emoji: meta?.emoji || item.fallbackEmoji,
        count,
        accentClass: item.accentClass,
        badgeClass: item.badgeClass,
      }
    })
  }, [careCategoryCounts])

  const getMessageSnippet = (text: string) => {
    if (!text) return 'Nova conversa'
    const lower = text.toLowerCase()
    if (lower.includes('imagemessage') || text === 'Foto')
      return (
        <>
          <Camera className="w-3.5 h-3.5 mr-1 inline" /> [Foto]
        </>
      )
    if (lower.includes('videomessage') || text === 'Vídeo')
      return (
        <>
          <Video className="w-3.5 h-3.5 mr-1 inline" /> [Vídeo]
        </>
      )
    if (lower.includes('audiomessage') || text === 'Áudio')
      return (
        <>
          <AudioLines className="w-3.5 h-3.5 mr-1 inline" /> [Áudio]
        </>
      )
    if (lower.includes('documentmessage') || text === 'Documento')
      return (
        <>
          <FileText className="w-3.5 h-3.5 mr-1 inline" /> [Documento]
        </>
      )
    return text
  }

  // Cards de métricas no topo solicitados:
  // 1. Follow-ups recuperados na semana
  // 2. Taxa de resposta em até 8h (%)
  // 3. Áudios transcritos (com pendentes)
  // 4. Conversas ativas
  const activeConversations =
    metrics?.conversationsStats?.active ?? metrics?.conversations ?? conversations.length
  const archivedConversations = metrics?.conversationsStats?.archived ?? 0
  const responseRate = metrics?.responseRate8h?.ratePct ?? 100
  const answeredCount = metrics?.responseRate8h?.answeredWithin8h ?? 0
  const totalAttendantMsgs = metrics?.responseRate8h?.totalAttendantMsgs ?? 0
  const audiosTranscribed = metrics?.audios?.transcribed ?? 0
  const audiosPending = metrics?.audios?.pending ?? 0
  const followupsRecovered = metrics?.followupsRecovered7d ?? 0
  const patientRecallStats = metrics?.patientRecall ?? { detected: 0, sentToday: 0, reengaged: 0 }
  const care2MonthsStats = metrics?.care2Months ?? { total: 0, contacted: 0, notContacted: 0 }

  if (sessionExpired) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white/80 backdrop-blur-md rounded-2xl border border-border shadow-sm text-center flex flex-col items-center gap-4 animate-fade-in">
        <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div>
          <h2 className="font-serif text-2xl font-bold text-primary">Sessão expirada</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Por segurança e atualização das permissões da clínica, sua sessão encerrou. Entre
            novamente para carregar o painel.
          </p>
        </div>
        <div className="flex gap-3 mt-2 w-full">
          <Button
            variant="outline"
            className="flex-1 rounded-full min-h-[44px]"
            onClick={async () => {
              try {
                if (pb.authStore.isValid || pb.authStore.token) {
                  await pb.collection('users').authRefresh()
                }
              } catch (_) {
                // se falhar, loadMetrics ainda tentará carregar
              }
              loadMetrics(false)
            }}
          >
            Tentar reconectar
          </Button>
          <Button
            className="flex-1 rounded-full min-h-[44px]"
            onClick={() => {
              pb.authStore.clear()
              navigate('/')
            }}
          >
            Entrar novamente
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 md:gap-8 animate-fade-in pb-12 w-full overflow-x-hidden">
      {/* Section 1: Hero, Instance Status & Manual Refresh */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
          <div className="flex items-center gap-4 md:gap-5">
            <Avatar className="h-14 w-14 md:h-16 md:w-16 border-2 border-background shadow-sm shrink-0">
              <AvatarImage
                src={
                  user?.avatar && typeof pb?.files?.getUrl === 'function'
                    ? pb.files.getUrl(user, user.avatar)
                    : ''
                }
              />
              <AvatarFallback className="bg-primary/5 text-primary font-serif font-bold text-xl md:text-2xl">
                {typeof user?.name === 'string' && user.name.trim().length > 0
                  ? user.name.trim().charAt(0).toUpperCase()
                  : 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5 md:gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground font-sans font-semibold text-[10px] md:text-xs uppercase tracking-widest">
                  {getGreeting()} · PAINEL DE COMANDO
                </span>
                <Badge
                  variant="outline"
                  className="bg-primary/5 text-primary border-primary/20 text-[10px] font-semibold h-4 px-1.5"
                >
                  Resumo do dia em uma tela
                </Badge>
              </div>
              <h1 className="text-2xl md:text-4xl lg:text-5xl font-bold text-primary tracking-tight font-sans leading-tight md:leading-none truncate">
                Olá,{' '}
                {typeof user?.name === 'string' && user.name.trim().length > 0
                  ? user.name.trim().split(' ')[0]
                  : 'Doutor(a)'}
              </h1>
              <p className="text-muted-foreground font-sans text-xs md:text-sm mt-0.5">
                {formattedDate} — Resumo operacional, atendimentos e demandas da clínica.
              </p>
              {headerTaskText && (
                <div
                  onClick={() => navigate('/tarefas')}
                  className="group flex items-center gap-1.5 mt-1.5 text-xs font-medium text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-full px-2.5 py-1 w-fit cursor-pointer transition-colors min-h-[32px]"
                >
                  <ListTodo className="w-3.5 h-3.5 text-amber-600" />
                  <span className="truncate">{headerTaskText}</span>
                  <ChevronRight className="w-3 h-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all duration-200" />
                </div>
              )}
            </div>
          </div>

          {teamMembers.length > 0 && (
            <div
              onClick={() => navigate('/equipe')}
              className="flex items-center gap-3 bg-white/50 border border-border/40 rounded-full py-1.5 px-3 md:px-4 cursor-pointer hover:bg-white hover:shadow-sm transition-all self-start md:self-auto min-h-[44px]"
            >
              <div className="flex -space-x-2">
                {teamMembers.slice(0, 4).map((member) => (
                  <Avatar key={member.id} className="w-8 h-8 border-2 border-white shadow-sm">
                    <AvatarImage
                      src={
                        member?.avatar && typeof pb?.files?.getUrl === 'function'
                          ? pb.files.getUrl(member, member.avatar)
                          : ''
                      }
                    />
                    <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold">
                      {typeof member?.name === 'string' && member.name.trim()
                        ? member.name.trim().charAt(0).toUpperCase()
                        : 'U'}
                    </AvatarFallback>
                  </Avatar>
                ))}{' '}
                {teamMembers.length > 4 && (
                  <div className="w-8 h-8 rounded-full border-2 border-white bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground z-10 shadow-sm">
                    +{teamMembers.length - 4}
                  </div>
                )}
              </div>
              <div className="hidden sm:flex flex-col">
                <span className="text-xs font-bold text-primary leading-none">Equipe</span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {teamMembers.length} {teamMembers.length === 1 ? 'membro' : 'membros'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Status WhatsApp + Botão Refresh Manual */}
        <div className="flex items-center gap-2 flex-wrap self-stretch sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadMetrics()
              refreshCommandCenter()
            }}
            disabled={loading || isRefreshing}
            className="rounded-full bg-white/80 border-border/40 hover:bg-white min-h-[44px] px-3.5 text-xs md:text-sm font-medium text-foreground/80 shadow-sm transition-all"
            title="Atualizar métricas agora"
          >
            <RefreshCw
              className={cn(
                'w-4 h-4 mr-2',
                (loading || isRefreshing) && 'animate-spin text-primary',
              )}
            />
            {isRefreshing ? 'Atualizando...' : 'Atualizar painel'}
          </Button>

          <button
            type="button"
            onClick={() => navigate('/conversas')}
            className="group flex items-center gap-2.5 px-4 py-2 bg-white/80 hover:bg-white border border-border/40 rounded-full transition-all shadow-sm hover:shadow-md text-xs md:text-sm shrink-0 min-h-[44px]"
          >
            <div className="relative flex h-2 w-2 md:h-2.5 md:w-2.5">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn('relative inline-flex rounded-full h-full w-full', statusColor)}
              />
            </div>
            <span className="font-semibold text-foreground/80">{statusText}</span>
            <span className="text-muted-foreground/40">•</span>
            <span className="text-muted-foreground hidden sm:inline truncate max-w-[140px] font-medium">
              {instanceLabel}
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground/60 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>

      {/* Banner de Servidor Reiniciando (502 / erro transitório de rede com retry automático) */}
      {backendRestarting && (
        <Alert className="border-amber-300 bg-amber-50/90 text-amber-900 shadow-sm animate-fade-in">
          <div className="flex items-start justify-between gap-3 w-full">
            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-amber-600 shrink-0 mt-0.5 animate-spin" />
              <div>
                <AlertTitle className="text-amber-950 text-sm font-semibold flex items-center gap-2">
                  <span>Servidor reiniciando, tentando de novo...</span>
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-100 text-[10px] text-amber-800"
                  >
                    Tentativa automática #{autoRetryCount + 1}
                  </Badge>
                </AlertTitle>
                <AlertDescription className="text-amber-800 text-xs mt-0.5">
                  O backend está aplicando uma atualização ou reconectando. Seus dados estão seguros
                  e o painel atualizará sozinho em instantes.
                </AlertDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-amber-300 text-amber-900 hover:bg-amber-100/80 shrink-0"
              onClick={() => {
                setAutoRetryCount((c) => c + 1)
                loadMetrics(false)
              }}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Tentar agora
            </Button>
          </div>
        </Alert>
      )}

      {/* Alerta de erro com botão Tentar novamente */}
      {error && !loading && !backendRestarting && (
        <Alert variant="destructive" className="border-rose-200 bg-rose-50 animate-fade-in">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="text-rose-900 text-sm font-semibold">
                Erro ao carregar dados do painel de gestão
              </AlertTitle>
              <AlertDescription className="text-rose-700 text-xs mt-0.5">{error}</AlertDescription>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-rose-300 text-rose-800 hover:bg-rose-100 min-h-[44px] sm:min-h-[32px]"
                  onClick={() => loadMetrics()}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Tentar novamente
                </Button>
              </div>
            </div>
          </div>
        </Alert>
      )}

      {/* Alerta de verificação de status */}
      {statusCheckFailed && !statusWarningDismissed && (
        <Alert className="border-amber-200 bg-amber-50 animate-fade-in">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="text-amber-900 text-sm font-semibold">
                Não foi possível verificar o status da instância
              </AlertTitle>
              <AlertDescription className="text-amber-700 text-xs mt-0.5">
                Verifique sua conexão e tente novamente.
              </AlertDescription>
              <div className="flex gap-2 mt-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 min-h-[44px] sm:min-h-[28px]"
                  onClick={() => checkInstanceStatus()}
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Tentar novamente
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-amber-700 hover:bg-amber-100 min-h-[44px] sm:min-h-[28px]"
                  onClick={() => setStatusWarningDismissed(true)}
                >
                  Dispensar
                </Button>
              </div>
            </div>
          </div>
        </Alert>
      )}

      {/* ═══ PAINEL DE COMANDO (X-RAY) — 4 MÉTRICAS + SAÚDE DAS AUTOMAÇÕES ═══ */}
      <Card className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/30">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-xl text-primary">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="font-serif text-lg md:text-xl font-bold text-primary">
                  Painel de Comando
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground font-sans">
                  Situação operacional da clínica neste momento
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/painel')}
                className="h-7 text-xs px-2.5 gap-1.5 border-primary/20 text-primary hover:bg-primary/5 hidden sm:inline-flex"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Área Gestão</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/financeiro')}
                className="h-7 text-xs px-2.5 gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50 hidden md:inline-flex"
              >
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span>Financeiro</span>
              </Button>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-bold border-0 shrink-0',
                  (commandCenter.unreadConversations ?? 0) +
                    pendingTasksCount +
                    (commandCenter.todayAppointments ?? 0) +
                    overdueTasksCount >
                    0
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800',
                )}
              >
                {(commandCenter.unreadConversations ?? 0) +
                  pendingTasksCount +
                  (commandCenter.todayAppointments ?? 0) +
                  overdueTasksCount >
                0
                  ? 'Ação necessária'
                  : 'Tudo em dia'}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* (a) Conversas não lidas */}
            <button
              type="button"
              onClick={() => navigate('/conversas')}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white text-left transition-all hover:shadow-sm hover:border-primary/40 min-h-[56px]"
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Inbox className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block font-serif font-bold text-xl text-primary leading-none">
                  {commandCenter.unreadConversations ?? '—'}
                </span>
                <span className="block text-[11px] text-muted-foreground font-medium mt-1 leading-tight">
                  Conversas não lidas
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>

            {/* (b) Tarefas pendentes */}
            <button
              type="button"
              onClick={() => navigate('/tarefas')}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white text-left transition-all hover:shadow-sm hover:border-primary/40 min-h-[56px]"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <ListTodo className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block font-serif font-bold text-xl text-primary leading-none">
                  {pendingTasksCount}
                </span>
                <span className="block text-[11px] text-muted-foreground font-medium mt-1 leading-tight">
                  Tarefas pendentes
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>

            {/* (c) Agendamentos de hoje */}
            <button
              type="button"
              onClick={() => navigate('/agenda')}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white text-left transition-all hover:shadow-sm hover:border-primary/40 min-h-[56px]"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <CalendarClock className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block font-serif font-bold text-xl text-primary leading-none">
                  {commandCenter.todayAppointments ?? '—'}
                </span>
                <span className="block text-[11px] text-muted-foreground font-medium mt-1 leading-tight">
                  Agendamentos de hoje
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>

            {/* (d) Pendências há mais de 24h */}
            <button
              type="button"
              onClick={() => navigate('/tarefas')}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white text-left transition-all hover:shadow-sm hover:border-rose-300 min-h-[56px]"
            >
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Timer className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block font-serif font-bold text-xl text-primary leading-none">
                  {overdueTasksCount}
                </span>
                <span className="block text-[11px] text-muted-foreground font-medium mt-1 leading-tight">
                  Pendências &gt; 24h
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </button>
          </div>

          {/* (e) Saúde das automações */}
          <div className="mt-3.5 pt-3.5 border-t border-border/30 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              Saúde das automações
            </span>
            <span className="flex items-center gap-1.5 text-indigo-700 font-medium">
              <Calendar className="w-3.5 h-3.5" />
              <button
                type="button"
                onClick={() => navigate('/fila')}
                className="hover:underline flex items-center gap-1"
                title="Abrir fila do fim de semana"
              >
                Fim de Semana (Plantão)
              </button>
            </span>
            <span className="flex items-center gap-1.5">
              {commandCenter.automations.globalPaused ? (
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              ) : commandCenter.automations.globalPaused === false ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              )}
              <span className="font-medium text-foreground/80">
                {commandCenter.automations.globalPaused
                  ? 'Pausadas globalmente (nada envia mensagem)'
                  : commandCenter.automations.globalPaused === false
                    ? 'Ativas globalmente'
                    : 'Estado desconhecido'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  commandCenter.automations.nightShield ? 'bg-indigo-500' : 'bg-gray-300',
                )}
              />
              <span className="font-medium text-foreground/80">
                Night Shield{' '}
                {commandCenter.automations.nightShield ? 'ativo (21h–07h)' : '(21h–07h)'}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <Clock className="w-3.5 h-3.5" />
              {commandCenter.automations.lastSyncAt ? (
                <>
                  Última sincronia: {formatRecentActivityDate(commandCenter.automations.lastSyncAt)}
                  {' · '}
                  {formatTimeSaoPaulo(commandCenter.automations.lastSyncAt)}
                </>
              ) : (
                'Última sincronia: sem registro'
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ═══ CONTROLE DE MENSAGENS AUTOMÁTICAS (STATUS DISCRETO NO PAINEL) ═══ */}
      <AutomationsControlCard compact />

      {/* ═══ SECTION 2: CARDS DE MÉTRICAS EM CAMADAS ABAIXO ═══ */}
      {/* Responsivo: coluna única no mobile (grid-cols-1), 2 colunas em telas médias, 4 em desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 md:gap-5">
        {/* Card 1: Follow-ups recuperados na semana */}
        <Card
          onClick={() => navigate('/tarefas')}
          className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:border-emerald-300/80 transition-all duration-200 cursor-pointer rounded-2xl overflow-hidden group min-h-[140px]"
        >
          <CardContent className="p-5 md:p-6 flex flex-col justify-between h-full gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-sans">
                Follow-ups na semana
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <HeartHandshake className="w-4 h-4" />
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-20 rounded-md" />
                <Skeleton className="h-4 w-32 rounded-md" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-bold font-serif text-primary tracking-tight leading-none">
                    {followupsRecovered}
                  </span>
                  <span className="text-xs text-muted-foreground font-sans">pacientes</span>
                </div>
                <p className="text-xs text-emerald-700 font-medium flex items-center gap-1 mt-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Cuidado e follow-ups recuperados nos últimos 7 dias</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Taxa de resposta em até 8h */}
        <Card
          onClick={() => navigate('/conversas')}
          className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:border-blue-300/80 transition-all duration-200 cursor-pointer rounded-2xl overflow-hidden group min-h-[140px]"
        >
          <CardContent className="p-5 md:p-6 flex flex-col justify-between h-full gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-sans">
                Taxa de resposta em 8h
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-20 rounded-md" />
                <Skeleton className="h-4 w-32 rounded-md" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-bold font-serif text-primary tracking-tight leading-none">
                    {responseRate}%
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] font-bold border-0',
                      responseRate >= 80
                        ? 'bg-emerald-100 text-emerald-800'
                        : responseRate >= 60
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800',
                    )}
                  >
                    {responseRate >= 80 ? 'Excelente' : responseRate >= 60 ? 'Atenção' : 'Crítico'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-sans mt-1">
                  {totalAttendantMsgs > 0
                    ? `${answeredCount} de ${totalAttendantMsgs} contatos responderam em até 8h`
                    : 'Aguardando fluxo de mensagens na semana'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 3: Áudios transcritos (com pendentes) */}
        <Card
          onClick={() => navigate('/conversas')}
          className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:border-violet-300/80 transition-all duration-200 cursor-pointer rounded-2xl overflow-hidden group min-h-[140px]"
        >
          <CardContent className="p-5 md:p-6 flex flex-col justify-between h-full gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-sans">
                Áudios Transcritos
              </span>
              <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                <Mic className="w-4 h-4" />
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-20 rounded-md" />
                <Skeleton className="h-4 w-32 rounded-md" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-bold font-serif text-primary tracking-tight leading-none">
                    {audiosTranscribed}
                  </span>
                  <span className="text-xs text-muted-foreground font-sans">transcritos úteis</span>
                </div>
                <div className="flex items-center flex-wrap gap-1.5 mt-1">
                  {audiosPending > 0 ? (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-amber-100 text-amber-800 font-semibold border-amber-200"
                    >
                      {audiosPending} pendente{audiosPending === 1 ? '' : 's'} (7d)
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold border-emerald-200"
                    >
                      Fila em dia
                    </Badge>
                  )}
                  {metrics?.dailyUsage && (
                    <span className="text-[10px] text-muted-foreground font-sans">
                      • Hoje: {metrics.dailyUsage.transcriptions_count}/
                      {metrics.dailyUsage.transcriptions_limit} áudios |{' '}
                      {metrics.dailyUsage.ai_analyses_count}/{metrics.dailyUsage.ai_analyses_limit}{' '}
                      IA
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground font-sans">IA ativa</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 4: Conversas ativas */}
        <Card
          onClick={() => navigate('/conversas')}
          className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:border-emerald-300/80 transition-all duration-200 cursor-pointer rounded-2xl overflow-hidden group min-h-[140px]"
        >
          <CardContent className="p-5 md:p-6 flex flex-col justify-between h-full gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider font-sans">
                Conversas Ativas
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4" />
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-20 rounded-md" />
                <Skeleton className="h-4 w-32 rounded-md" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl md:text-5xl font-bold font-serif text-primary tracking-tight leading-none">
                    {activeConversations}
                  </span>
                  <span className="text-xs text-muted-foreground font-sans">em andamento</span>
                </div>
                <p className="text-xs text-muted-foreground font-sans mt-1">
                  {archivedConversations > 0
                    ? `${archivedConversations} conversas arquivadas`
                    : 'Todas as conversas ativas no momento'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ CARD DE PESQUISA DE SATISFAÇÃO (NPS E TAXA DE RESPOSTA) ═══ */}
      <Card
        onClick={() => navigate('/integracoes')}
        className="border-border/50 bg-gradient-to-r from-emerald-50/60 via-white/80 to-teal-50/40 backdrop-blur-md shadow-sm hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer rounded-2xl p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-base text-primary">
                  Pesquisa de Satisfação Pós-Consulta
                </h3>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300"
                >
                  Disparo 14:37 (3h pós)
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Avaliação de 0 a 10 e sugestões coletadas pela Fabiana com resumo mensal para o Dr.
                Caio
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-6 text-xs divide-x divide-border/60 flex-wrap sm:flex-nowrap">
            <div className="flex flex-col items-center">
              <span className="text-lg sm:text-2xl font-bold font-serif text-emerald-700">
                {surveyStats?.averageScore !== null && surveyStats?.averageScore !== undefined
                  ? `${surveyStats.averageScore} / 10`
                  : '-'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Nota Média
              </span>
            </div>

            <div className="flex flex-col items-center pl-3 sm:pl-6">
              <span className="text-lg sm:text-2xl font-bold font-serif text-primary">
                {surveyStats ? `${surveyStats.responseRate}%` : '0%'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Taxa de Resposta
              </span>
            </div>

            <div className="flex flex-col items-center pl-3 sm:pl-6">
              <span className="text-lg sm:text-2xl font-bold font-serif text-teal-700">
                {surveyStats?.nps !== null && surveyStats?.nps !== undefined
                  ? `${surveyStats.nps > 0 ? '+' : ''}${surveyStats.nps}`
                  : '-'}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                NPS Estimado
              </span>
            </div>

            <div className="flex flex-col items-center pl-3 sm:pl-6">
              <span className="text-lg sm:text-2xl font-bold font-serif text-foreground">
                {surveyStats ? surveyStats.totalReceived : 0}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Respostas ({surveyStats?.totalSent || 0} enviadas)
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ CARD DE RECALL DE PACIENTES INATIVOS ═══ */}
      <Card
        onClick={() => navigate('/agenda')}
        className="border-border/50 bg-gradient-to-r from-rose-50/50 via-white/80 to-purple-50/40 backdrop-blur-md shadow-sm hover:shadow-md hover:border-rose-300 transition-all cursor-pointer rounded-2xl p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-base text-primary">
                  Recall de Pacientes Inativos
                </h3>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                >
                  Disparo diário 03:15
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mensagem acolhedora de retorno para pacientes sem mensagens nos últimos dias
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5 text-xs divide-x divide-border/60 flex-wrap sm:flex-nowrap">
            <div className="flex flex-col items-center">
              <span className="text-lg sm:text-2xl font-bold font-serif text-primary">
                {patientRecallStats.detected}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Detectados
              </span>
            </div>

            <div className="flex flex-col items-center pl-3 sm:pl-5">
              <span className="text-lg sm:text-2xl font-bold font-serif text-emerald-600">
                {patientRecallStats.sentToday}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Enviados Hoje
              </span>
            </div>

            <div className="flex flex-col items-center pl-3 sm:pl-5">
              <span className="text-lg sm:text-2xl font-bold font-serif text-purple-600">
                {patientRecallStats.reengaged}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Reengajados
              </span>
            </div>

            {/* Métricas de Cuidado - Últimos 2 meses: Acionados vs Não Acionados */}
            <div className="flex flex-col items-center pl-3 sm:pl-5">
              <div className="flex items-center gap-1.5">
                <span className="text-lg sm:text-2xl font-bold font-serif text-teal-600">
                  {care2MonthsStats.contacted}
                </span>
                <span className="text-xs text-muted-foreground font-serif">/</span>
                <span className="text-sm sm:text-base font-semibold font-serif text-amber-600">
                  {care2MonthsStats.notContacted}
                </span>
              </div>
              <span
                className="text-[10px] text-muted-foreground uppercase tracking-wide"
                title="Pacientes com lembrete/recall enviado vs pendentes nos últimos 2 meses"
              >
                Acionados / Pendentes (2m)
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ BANNER DE DESTAQUE: FASE 4 — PAINEL DE REVENDA ═══ */}
      <Card
        onClick={() => navigate('/revenda')}
        className="border-border/50 bg-gradient-to-r from-purple-50/70 via-white/80 to-indigo-50/50 backdrop-blur-md shadow-sm hover:shadow-md hover:border-purple-300 transition-all cursor-pointer rounded-2xl p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-base text-primary">
                  Painel de Revenda — Score de Interesse (Fase 4)
                </h3>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-purple-50 text-purple-800 border-purple-200"
                >
                  Score 0–100
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Priorização de oportunidades nos 5 segmentos: Retomada, Fechamento, Renovação, Novo
                serviço e Reativação.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-purple-200 text-purple-800 hover:bg-purple-100/50 pointer-events-none"
            >
              Abrir Painel de Revenda <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

      {/* ═══ SECTION RELATÓRIO DE FOLLOW-UPS: PACIENTES RECUPERADOS POR REGRA ═══ */}
      <FollowupRecoveryReport />

      {/* ═══ SECTION 3: FUNIL DE PACIENTES + PENDÊNCIAS DE CUIDADO ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Funil de pacientes por estágio (Lead ao Cliente) - 7 colunas no desktop */}
        <Card className="lg:col-span-7 border-border/40 bg-white/60 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden flex flex-col">
          <CardHeader className="pb-3 border-b border-border/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-primary">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <CardTitle className="font-serif text-lg md:text-xl font-bold text-primary">
                    Funil de Pacientes da Clínica
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground font-sans">
                    Acompanhamento de estágios: do primeiro contato até o cuidado contínuo
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/crm')}
                className="text-xs text-primary font-semibold min-h-[44px] sm:min-h-[32px] self-start sm:self-auto"
              >
                Ver pipeline <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-4 md:p-6 flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                    <Skeleton className="h-3 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ) : funnelStages.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground">
                <Users className="w-10 h-10 mb-2 opacity-20" />
                <p className="text-sm font-medium">Nenhum estágio de paciente cadastrado.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/crm')}
                  className="mt-3 min-h-[44px] rounded-full"
                >
                  Configurar etapas no CRM
                </Button>
              </div>
            ) : (
              <div className="space-y-4 md:space-y-5">
                {funnelStages.map((stage) => {
                  const style = stageStyle(stage.color)
                  const count = stage.count || 0
                  const pct =
                    funnelTotalPatients > 0 ? Math.round((count / funnelTotalPatients) * 100) : 0

                  return (
                    <div
                      key={stage.key}
                      onClick={() => navigate(`/crm?stage=${stage.key}`)}
                      className="group cursor-pointer p-2.5 rounded-xl hover:bg-black/[0.02] transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs md:text-sm font-medium mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2.5 h-2.5 rounded-full', style.dot)} />
                          <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                            {stage.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-serif font-bold text-base md:text-lg text-primary">
                            {count}
                          </span>
                          <span className="text-[11px] text-muted-foreground">({pct}%)</span>
                        </div>
                      </div>

                      {/* Barra de progresso horizontal customizada */}
                      <div className="w-full bg-muted/60 h-2.5 md:h-3 rounded-full overflow-hidden p-0.5">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            style.dot,
                          )}
                          style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}

                <div className="pt-3 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground font-sans">
                  <span>Total de contatos no funil:</span>
                  <span className="font-bold text-primary font-serif text-sm">
                    {funnelTotalPatients} pacientes
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pendências de Cuidado por Categoria - 5 colunas no desktop */}
        <Card className="lg:col-span-5 border-border/40 bg-white/60 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden flex flex-col">
          <CardHeader className="pb-3 border-b border-border/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <CardTitle className="font-serif text-lg md:text-xl font-bold text-primary">
                    Pendências de Cuidado
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground font-sans">
                    Atenção nutricional prioritária por categoria
                  </CardDescription>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-primary/10 text-primary border-0 font-bold text-xs"
              >
                {totalCarePending} total
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-4 md:p-6 flex-1 flex flex-col justify-center">
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : totalCarePending === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-center text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mb-2 text-emerald-500 opacity-80" />
                <p className="text-sm font-semibold text-foreground">
                  Tudo em dia com os pacientes!
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Nenhuma pendência ativa de cuidado no momento.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/tarefas')}
                  className="mt-3 min-h-[44px] rounded-full text-xs"
                >
                  Abrir Central de Tarefas
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {careCategoriesList.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate('/tarefas')}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-xl border border-border/40 text-left transition-all hover:shadow-sm min-h-[48px]',
                      item.accentClass,
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <span className="text-lg leading-none shrink-0">{item.emoji}</span>
                      <span className="text-xs font-semibold truncate leading-tight">
                        {item.label}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'text-xs font-bold px-2 py-0.5 rounded-full border shrink-0',
                        item.badgeClass,
                      )}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-border/30 flex justify-between items-center">
              <span className="text-xs text-muted-foreground font-sans">
                Monitorado automaticamente pela IA
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/tarefas')}
                className="text-xs text-primary font-semibold min-h-[44px] sm:min-h-[32px] p-0"
              >
                Gerenciar na tela de Tarefas →
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ SECTION 4: GRÁFICO 7 DIAS + TAREFAS URGENTES + ATALHOS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Gráfico 7 dias */}
        <Card className="lg:col-span-2 border-border/40 bg-white/60 backdrop-blur-md shadow-sm rounded-2xl overflow-hidden flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-serif text-xl font-bold text-primary">
                  Volume de Mensagens (7 dias)
                </CardTitle>
                <CardDescription className="text-xs md:text-sm text-muted-foreground font-sans">
                  Enviadas pela equipe vs. Recebidas de pacientes ao longo da semana
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs bg-white/80">
                {metrics?.messagesToday || 0} hoje
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-end pt-4">
            {loading ? (
              <div className="flex items-end justify-around h-48 gap-2 mt-4">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="w-full max-w-[48px] h-full rounded-t-md opacity-20"
                  />
                ))}
              </div>
            ) : (
              <>
                <div className="relative flex items-end justify-around h-48 gap-2 mt-4">
                  {maxTotal === 1 && chartData.every((d) => d.total === 0) && (
                    <div className="absolute inset-0 pb-6 flex flex-col items-center justify-center text-muted-foreground text-center pointer-events-none z-0">
                      <BarChart3 className="w-10 h-10 mb-3 opacity-20" />
                      <span className="text-sm font-medium">
                        Assim que novas mensagens chegarem, o fluxo diário é contabilizado aqui!
                      </span>
                    </div>
                  )}
                  {chartData.map((d, i) => {
                    const totalHeight = `${(d.total / maxTotal) * 100}%`
                    const receivedPct = d.total > 0 ? (d.received / d.total) * 100 : 0
                    const sentPct = d.total > 0 ? (d.sent / d.total) * 100 : 0

                    return (
                      <Tooltip key={i} delayDuration={100}>
                        <TooltipTrigger asChild>
                          <div className="flex flex-col items-center flex-1 gap-2 group z-10 h-full cursor-default">
                            <div className="w-full flex-1 flex flex-col justify-end items-center px-1 relative">
                              <div
                                className="w-full max-w-[48px] rounded-t-md overflow-hidden flex flex-col justify-end transition-all duration-1000 ease-out bg-black/5 hover:ring-2 hover:ring-primary/20"
                                style={{ height: d.total === 0 ? '4px' : totalHeight }}
                              >
                                {d.total > 0 && (
                                  <>
                                    <div
                                      className="w-full bg-emerald-500 hover:brightness-110 transition-all"
                                      style={{ height: `${receivedPct}%` }}
                                    />
                                    <div
                                      className="w-full bg-emerald-300 hover:brightness-110 transition-all"
                                      style={{ height: `${sentPct}%` }}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                              {d.label}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="bg-popover text-popover-foreground border-border shadow-lg font-sans z-50"
                        >
                          <div className="flex flex-col gap-1.5 text-xs min-w-[140px] p-1">
                            <div className="font-bold text-sm mb-1 text-primary capitalize">
                              {(() => {
                                try {
                                  const dateVal = d?.date
                                    ? `${d.date}T12:00:00Z`
                                    : d?.dayStartSec
                                      ? d.dayStartSec * 1000
                                      : null
                                  if (dateVal) {
                                    const parsed = parseToDate(dateVal)
                                    if (parsed) {
                                      const formatted = formatLongDateSaoPaulo(parsed, false)
                                      if (formatted) return formatted
                                    }
                                  }
                                } catch {
                                  /* intentionally ignored */
                                }
                                return d?.label || 'Dia'
                              })()}
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></div>{' '}
                                Recebidas
                              </span>
                              <span className="font-semibold text-primary">{d.received}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                                <div className="w-2.5 h-2.5 rounded-sm bg-emerald-300"></div>{' '}
                                Enviadas
                              </span>
                              <span className="font-semibold text-primary">{d.sent}</span>
                            </div>
                            <div className="border-t border-border mt-1 pt-1.5 flex items-center justify-between gap-4 font-bold text-primary">
                              <span>Total</span>
                              <span>{d.total}</span>
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
                <div className="flex items-center justify-center gap-6 mt-6 pt-4 border-t border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span className="text-xs font-medium text-muted-foreground font-sans">
                      Recebidas (Pacientes)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-300"></div>
                    <span className="text-xs font-medium text-muted-foreground font-sans">
                      Enviadas (Clínica)
                    </span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tarefas Urgentes e Atalhos Rápidos */}
        <div className="flex flex-col gap-6">
          <Card className="border-border/40 bg-white/60 backdrop-blur-md shadow-sm rounded-2xl flex flex-col">
            <CardHeader className="pb-3 px-5 pt-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <ListTodo className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="font-serif text-lg font-bold text-primary">
                      Minhas tarefas urgentes
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground font-sans">
                      Demandas prioritárias atribuídas a você
                    </CardDescription>
                  </div>
                </div>
                {tasksError && (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-amber-700 bg-amber-50 border-amber-200"
                  >
                    Modo offline
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 flex flex-col gap-3">
              {tasksError && myUrgentTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-4 text-center text-muted-foreground">
                  <AlertCircle className="w-6 h-6 mb-1 text-amber-500/70" />
                  <span className="text-xs font-medium text-amber-800">
                    Não foi possível carregar as tarefas
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5">
                    As demais seções continuam funcionando normalmente.
                  </span>
                </div>
              ) : myUrgentTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mb-2 opacity-20 text-emerald-600" />
                  <span className="text-sm font-medium">Sem tarefas pendentes</span>
                </div>
              ) : (
                myUrgentTasks.slice(0, 4).map((task) => {
                  const meta = getPriorityMeta(task.priority)
                  const dueStr = task.due_date || ''
                  const todayKey = getDayKeySaoPaulo(new Date())
                  const dueKey = dueStr ? getDayKeySaoPaulo(dueStr) : ''
                  const isOverdue = !!(dueKey && dueKey < todayKey)
                  const formattedDue = dueStr ? formatBrazilianDate(dueStr, false) : ''

                  return (
                    <div
                      key={task.id}
                      className="p-3 bg-white border border-border/40 rounded-xl cursor-pointer hover:shadow-sm transition-all group min-h-[44px]"
                      onClick={() => {
                        setSelectedTask(task)
                        setTaskDialogOpen(true)
                      }}
                    >
                      <h4 className="font-semibold text-sm text-primary truncate group-hover:text-primary/80 mb-2">
                        {task.title || 'Tarefa sem título'}
                      </h4>
                      <div className="flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 h-4 border uppercase tracking-wider',
                            meta?.color || 'text-muted-foreground border-border',
                          )}
                        >
                          {meta?.label || 'Normal'}
                        </Badge>
                        {formattedDue && (
                          <span
                            className={cn(
                              'text-[11px] font-semibold',
                              isOverdue ? 'text-rose-600' : 'text-muted-foreground',
                            )}
                          >
                            {isOverdue ? '⚠ Vencida' : `Vence ${formattedDue}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              {myUrgentTasks.length > 4 && (
                <Button
                  variant="ghost"
                  className="w-full text-sm text-primary mt-1 min-h-[44px]"
                  onClick={() => navigate('/tarefas')}
                >
                  Ver todas as tarefas ({myUrgentTasks.length})
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Atalhos Rápidos */}
          <div className="flex flex-col gap-3">
            <h3 className="font-serif text-lg font-bold text-primary px-1">Acesso Rápido</h3>
            {shortcuts.map((s, i) => (
              <Card
                key={i}
                onClick={() => navigate(s.link)}
                className="cursor-pointer group hover:bg-black/5 hover:scale-[1.01] transition-all duration-200 border-border/40 shadow-sm rounded-xl min-h-[48px]"
              >
                <CardContent className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2.5 rounded-xl shrink-0', s.bg)}>
                      <s.icon className={cn('w-4 h-4', s.color)} />
                    </div>
                    <div>
                      <h4 className="font-serif font-semibold text-primary text-sm">{s.title}</h4>
                      <p className="text-xs text-muted-foreground font-sans">{s.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ SECTION 5: ATIVIDADE RECENTE (CONVERSAS WHATSAPP) ═══ */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h2 className="font-serif text-xl md:text-2xl font-bold text-primary">
              Atividade Recente no WhatsApp
            </h2>
            <p className="text-xs text-muted-foreground font-sans">
              Últimas interações de pacientes recebidas pela clínica
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/conversas')}
            className="text-primary font-semibold min-h-[44px] text-xs md:text-sm"
          >
            Ver todas <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        <Card className="border-border/40 shadow-sm rounded-2xl overflow-hidden bg-white/60 backdrop-blur-md">
          {loading ? (
            <div className="divide-y divide-border/30">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 md:p-5 flex items-center gap-4 min-h-[44px]">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Skeleton className="h-3 w-10" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentChats.length === 0 ? (
            <div className="p-10 flex flex-col items-center justify-center text-center">
              <div className="p-4 rounded-full bg-emerald-50 mb-4">
                <MessageSquare className="w-10 h-10 text-emerald-500/40" />
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mb-2">
                Sua caixa de entrada está em dia
              </h3>
              <p className="text-sm text-muted-foreground font-sans mb-6 max-w-sm">
                Assim que seus pacientes enviarem mensagens ou áudios, eles aparecerão aqui com a
                transcrição e ações recomendadas.
              </p>
              <Button onClick={() => navigate('/conversas')} className="min-h-[44px] rounded-full">
                <MessageSquare className="w-4 h-4 mr-2" />
                Abrir Conversas
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {recentChats.map((chat) => {
                if (!chat) return null
                const title = chat.contact_name || chat.remote_jid || 'Conversa'
                const rawTs =
                  chat.last_message_timestamp && chat.last_message_timestamp > 0
                    ? chat.last_message_timestamp
                    : chat.updated
                let relativeTime = ''
                try {
                  relativeTime = rawTs ? formatRecentActivityDate(rawTs) : ''
                } catch (_) {
                  relativeTime = ''
                }
                return (
                  <div
                    key={chat.id}
                    className="p-4 md:p-5 flex items-center gap-4 hover:bg-black/5 transition-colors cursor-pointer group min-h-[48px]"
                    onClick={() => navigate(`/conversas?chat=${chat.id}`)}
                  >
                    <Avatar className="h-10 w-10 border border-border/50 shadow-sm shrink-0">
                      <AvatarImage src={chat.avatar_url || ''} />
                      <AvatarFallback className="bg-primary/5 text-primary font-serif font-bold text-lg">
                        {typeof title === 'string' && title.trim().length > 0
                          ? title.trim().charAt(0).toUpperCase()
                          : '?'}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-serif font-bold text-primary truncate text-base">
                          {title}
                        </p>
                        {chat.type === 'group' && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 font-bold tracking-wider"
                          >
                            GRUPO
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground truncate pr-4 font-sans flex items-center">
                        {getMessageSnippet(chat.last_message || '')}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {relativeTime && (
                        <span className="text-[11px] text-muted-foreground font-semibold whitespace-nowrap">
                          {relativeTime}
                        </span>
                      )}
                      {typeof chat.unread_count === 'number' && chat.unread_count > 0 ? (
                        <div className="bg-emerald-500 text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center shadow-sm">
                          {chat.unread_count}
                        </div>
                      ) : (
                        <div className="h-5"></div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <TaskViewDialog
        task={selectedTask}
        open={taskDialogOpen}
        onOpenChange={(open) => {
          setTaskDialogOpen(open)
          if (!open) setSelectedTask(null)
        }}
      />
    </div>
  )
}
