import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
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
  type PatientGroupFilters,
} from '@/services/crm_care_service'
import { CareFilters, type CareFilterValues } from '@/components/chat/CareFilters'
import { PatientCardItem } from '@/components/chat/PatientCardItem'

interface CareSidebarProps {
  open: boolean
  onClose: () => void
  onSelectPatient: (patient: PatientCard) => void
}

interface GroupConfig {
  key: keyof PatientGroupsData['groups']
  label: string
  emoji: string
  color: string
  bgColor: string
  borderColor: string
}

const GROUP_CONFIGS: GroupConfig[] = [
  {
    key: 'precisa_retorno',
    label: 'Precisam de retorno',
    emoji: '🔄',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  {
    key: 'nao_responderam',
    label: 'Não responderam',
    emoji: '⏰',
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
  },
  {
    key: 'precisam_de_acao',
    label: 'Precisam de ação',
    emoji: '⚡',
    color: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
  },
  {
    key: 'precisam_de_consulta',
    label: 'Precisam de consulta',
    emoji: '📅',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    key: 'followup_window',
    label: '10–15 dias pós-consulta',
    emoji: '⏳',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
  },
  {
    key: 'alta_demanda',
    label: 'Alta demanda',
    emoji: '🚨',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
]

export function CareSidebar({ open, onClose, onSelectPatient }: CareSidebarProps) {
  const [data, setData] = useState<PatientGroupsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('')
  const [filterValues, setFilterValues] = useState<CareFilterValues>({
    period_days: '0',
    care_status: '',
    min_priority: '0',
  })
  const abortControllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const filters: PatientGroupFilters = {}
        const pd = Number(filterValues.period_days)
        if (pd > 0) filters.period_days = pd
        const mp = Number(filterValues.min_priority)
        if (mp > 0) filters.min_priority = mp
        const cs = filterValues.care_status === 'all' ? '' : filterValues.care_status
        if (cs) filters.care_status = cs
        const hasFilters = Object.keys(filters).length > 0
        const res = await getPatientGroups(hasFilters ? filters : undefined, signal)
        if (signal?.aborted) return
        setData(res)
      } catch {
        /* ignored */
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    [filterValues],
  )

  useEffect(() => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [load])

  useRealtime('crm_contacts', () => load())
  useRealtime('whatsapp_messages', () => load())
  useRealtime('conversations', () => load())
  useRealtime('care_alerts', () => load())

  useEffect(() => {
    if (!activeTab && data) {
      const first = GROUP_CONFIGS.find((c) => (data.groups[c.key] || []).length > 0)
      if (first) setActiveTab(first.key)
    }
  }, [data, activeTab])

  const handleOpenWhatsapp = (patient: PatientCard) => {
    const phone = patient.phone || patient.jid?.split('@')[0] || ''
    if (phone) window.open(`https://wa.me/${phone}`, '_blank')
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

  const activeItems =
    data && activeTab ? data.groups[activeTab as keyof PatientGroupsData['groups']] || [] : []

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <div>
          <h2 className="font-serif text-lg font-bold text-primary">Painel de Cuidado</h2>
          <p className="text-xs text-muted-foreground">Acompanhamento de pacientes em tempo real</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full shrink-0">
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="px-4 pt-3 pb-2 border-b border-border/60 shrink-0">
        <CareFilters values={filterValues} onChange={setFilterValues} />
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="px-4 py-3 shrink-0">
            <div className="grid grid-cols-3 gap-2">
              {overviewCards.map((card) => (
                <div key={card.label} className={cn('rounded-xl p-2.5 text-center', card.bg)}>
                  <p className={cn('text-xl font-serif font-bold', card.color)}>{card.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{card.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 pb-2 space-y-1 shrink-0">
            {GROUP_CONFIGS.map((config) => {
              const items = data?.groups[config.key] || []
              const isActive = activeTab === config.key
              return (
                <button
                  key={config.key}
                  onClick={() => setActiveTab(config.key)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActive
                      ? cn(config.bgColor, config.color, 'font-semibold')
                      : 'hover:bg-muted text-muted-foreground',
                  )}
                >
                  <span className="text-base shrink-0">{config.emoji}</span>
                  <span className="flex-1 text-left">{config.label}</span>
                  <Badge
                    className={cn(
                      'text-[10px] border-0',
                      isActive
                        ? cn(config.bgColor, config.color)
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {items.length}
                  </Badge>
                </button>
              )
            })}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 pt-2 space-y-2">
              {activeItems.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    Nenhum paciente nesta categoria. 🎉
                  </p>
                </div>
              ) : (
                activeItems
                  .slice(0, 20)
                  .map((patient) => (
                    <PatientCardItem
                      key={patient.id}
                      patient={patient}
                      onClick={() => onSelectPatient(patient)}
                      onOpenWhatsapp={() => handleOpenWhatsapp(patient)}
                    />
                  ))
              )}
              {activeItems.length > 20 && (
                <p className="text-xs text-muted-foreground text-center py-1">
                  +{activeItems.length - 20} pacientes
                </p>
              )}
            </div>
          </ScrollArea>
        </>
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
