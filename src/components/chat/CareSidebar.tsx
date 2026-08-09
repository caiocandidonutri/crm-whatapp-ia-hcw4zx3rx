import { useState, useEffect, useCallback } from 'react'
import {
  X,
  RefreshCw,
  Clock,
  AlertTriangle,
  Zap,
  Calendar,
  Hourglass,
  Flame,
  ChevronRight,
  MessageCircle,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/use-realtime'
import {
  getPatientGroups,
  type PatientGroupsData,
  type PatientCard,
} from '@/services/crm_care_service'

interface CareSidebarProps {
  open: boolean
  onClose: () => void
  onSelectPatient: (patient: PatientCard) => void
}

interface GroupConfig {
  key: keyof PatientGroupsData['groups']
  label: string
  icon: typeof Clock
  color: string
  bgColor: string
  borderColor: string
}

const GROUP_CONFIGS: GroupConfig[] = [
  {
    key: 'precisa_retorno',
    label: 'Precisam de retorno',
    icon: RefreshCw,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  {
    key: 'nao_responderam',
    label: 'Não responderam',
    icon: Clock,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
  },
  {
    key: 'precisam_de_acao',
    label: 'Precisam de ação',
    icon: Zap,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
  },
  {
    key: 'precisam_de_consulta',
    label: 'Precisam de consulta',
    icon: Calendar,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    key: 'followup_window',
    label: '10–15 dias pós-consulta',
    icon: Hourglass,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
  },
  {
    key: 'alta_demanda',
    label: 'Alta demanda',
    icon: Flame,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
]

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  em_atendimento: 'Em atendimento',
  cliente: 'Cliente',
  nao_respondido: 'Não respondido',
}

function priorityBadge(priority: number) {
  if (priority >= 8) return { label: 'Urgente', className: 'bg-red-100 text-red-700' }
  if (priority >= 6) return { label: 'Alta', className: 'bg-orange-100 text-orange-700' }
  if (priority >= 4) return { label: 'Média', className: 'bg-amber-100 text-amber-700' }
  return { label: 'Baixa', className: 'bg-slate-100 text-slate-600' }
}

function PatientCardItem({
  patient,
  onClick,
  onOpenWhatsapp,
}: {
  patient: PatientCard
  onClick: () => void
  onOpenWhatsapp: () => void
}) {
  const badge = priorityBadge(patient.ai_priority)
  const stageLabel = STAGE_LABELS[patient.stage] || patient.stage || '—'

  return (
    <div
      className={cn(
        'group rounded-xl border border-border/40 bg-white p-3 transition-all hover:shadow-md hover:border-primary/30 cursor-pointer',
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{patient.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{stageLabel}</p>
        </div>
        <Badge className={cn('text-[10px] border-0 shrink-0', badge.className)}>
          {badge.label}
        </Badge>
      </div>
      {patient.ai_suggested_action && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {patient.ai_suggested_action}
        </p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full',
            patient.care_status === 'em_dia'
              ? 'bg-emerald-50 text-emerald-600'
              : patient.care_status === 'precisa_retorno'
                ? 'bg-amber-50 text-amber-600'
                : 'bg-rose-50 text-rose-600',
          )}
        >
          {patient.care_status === 'em_dia'
            ? 'Em dia'
            : patient.care_status === 'precisa_retorno'
              ? 'Retorno'
              : patient.care_status.startsWith('sem_contato')
                ? 'Sem contato'
                : patient.care_status}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs gap-1 text-primary hover:bg-primary/5"
          onClick={(e) => {
            e.stopPropagation()
            onOpenWhatsapp()
          }}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          WhatsApp
        </Button>
      </div>
    </div>
  )
}

export function CareSidebar({ open, onClose, onSelectPatient }: CareSidebarProps) {
  const [data, setData] = useState<PatientGroupsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await getPatientGroups()
      setData(res)
    } catch {
      /* ignored */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useRealtime('crm_contacts', () => load())
  useRealtime('whatsapp_messages', () => load())
  useRealtime('conversations', () => load())
  useRealtime('care_alerts', () => load())

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleOpenWhatsapp = (patient: PatientCard) => {
    const phone = patient.phone || patient.jid?.split('@')[0] || ''
    if (phone) {
      window.open(`https://wa.me/${phone}`, '_blank')
    }
  }

  const overviewCards = data
    ? [
        {
          label: 'Em dia',
          value: data.overview.em_dia,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
        },
        {
          label: 'Retorno',
          value: data.overview.precisa_retorno,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
        },
        {
          label: 'Desassistidos',
          value: data.overview.desassistidos,
          color: 'text-rose-600',
          bg: 'bg-rose-50',
        },
      ]
    : []

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h2 className="font-serif text-lg font-bold text-primary">Painel de Cuidado</h2>
          <p className="text-xs text-muted-foreground">Acompanhamento de pacientes em tempo real</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full shrink-0">
          <X className="w-5 h-5" />
        </Button>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {overviewCards.map((card) => (
                <div key={card.label} className={cn('rounded-xl p-2.5 text-center', card.bg)}>
                  <p className={cn('text-xl font-serif font-bold', card.color)}>{card.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{card.label}</p>
                </div>
              ))}
            </div>

            {GROUP_CONFIGS.map((config) => {
              const items = data?.groups[config.key] || []
              if (items.length === 0) return null
              const isCollapsed = collapsedGroups.has(config.key)
              const Icon = config.icon

              return (
                <div
                  key={config.key}
                  className={cn('rounded-xl border', config.borderColor, config.bgColor)}
                >
                  <button
                    onClick={() => toggleGroup(config.key)}
                    className="w-full flex items-center gap-2 p-3 text-left"
                  >
                    <Icon className={cn('w-4 h-4 shrink-0', config.color)} />
                    <span className="text-sm font-semibold text-foreground flex-1">
                      {config.label}
                    </span>
                    <Badge className={cn('text-[10px] border-0', config.bgColor, config.color)}>
                      {items.length}
                    </Badge>
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 text-muted-foreground transition-transform',
                        isCollapsed ? '' : 'rotate-90',
                      )}
                    />
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 pb-3 space-y-2">
                      {items.slice(0, 15).map((patient) => (
                        <PatientCardItem
                          key={patient.id}
                          patient={patient}
                          onClick={() => onSelectPatient(patient)}
                          onOpenWhatsapp={() => handleOpenWhatsapp(patient)}
                        />
                      ))}
                      {items.length > 15 && (
                        <p className="text-xs text-muted-foreground text-center py-1">
                          +{items.length - 15} pacientes
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {!data ||
              (GROUP_CONFIGS.every((c) => (data?.groups[c.key] || []).length === 0) && (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    Nenhum paciente precisa de atenção no momento. 🎉
                  </p>
                </div>
              ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )

  return (
    <>
      <div
        className={cn(
          'hidden lg:flex flex-col bg-background border-l border-border transition-all duration-300 overflow-hidden',
          open ? 'w-80 xl:w-96' : 'w-0',
        )}
      >
        {open && sidebarContent}
      </div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
          <div className="relative ml-auto w-full max-w-sm bg-background shadow-2xl animate-slide-down h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
