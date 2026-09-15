import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  MessageCircle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Building,
  User,
  Phone,
  FileText,
  CalendarDays,
  ExternalLink,
} from 'lucide-react'
import {
  format,
  addDays,
  startOfWeek,
  endOfWeek,
  isSameDay,
  parseISO,
  startOfDay,
  endOfDay,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { useCurrentAccount } from '@/hooks/use-current-account'
import pb from '@/lib/pocketbase/client'
import { cn } from '@/lib/utils'
import type { Appointment, AppointmentCity, AppointmentStatus } from '@/types/models'
import {
  listAppointments,
  createAppointment,
  updateAppointment,
  getAgendaSyncStatus,
  triggerAgendaSync,
  CITY_DEFAULT_LOCATIONS,
  type AgendaSyncStatus,
  type CreateAppointmentInput,
} from '@/services/appointments'

const CITIES: { id: AppointmentCity | 'all'; label: string; location: string }[] = [
  { id: 'all', label: 'Todas as cidades', location: 'Todos os locais' },
  { id: 'Carmo do Rio Claro', label: 'Carmo do Rio Claro', location: 'Climed' },
  { id: 'Alfenas', label: 'Alfenas', location: 'Instituto Harmoniza' },
  { id: 'Monte Belo', label: 'Monte Belo', location: 'Monte Belo' },
  { id: 'Online', label: 'Online', location: 'Consulta Remota' },
]

const STATUS_CONFIG: Record<
  AppointmentStatus,
  { label: string; badgeClass: string; borderClass: string; icon: React.ElementType }
> = {
  confirmado: {
    label: 'Confirmado',
    badgeClass:
      'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300',
    borderClass: 'border-l-4 border-l-emerald-500',
    icon: CheckCircle2,
  },
  agendado: {
    label: 'Agendado',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300',
    borderClass: 'border-l-4 border-l-blue-500',
    icon: Clock,
  },
  realizado: {
    label: 'Realizado',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300',
    borderClass: 'border-l-4 border-l-teal-500',
    icon: CheckCircle2,
  },
  faltou: {
    label: 'Faltou',
    badgeClass: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300',
    borderClass: 'border-l-4 border-l-red-500',
    icon: XCircle,
  },
  remarcado: {
    label: 'Remarcado',
    badgeClass:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300',
    borderClass: 'border-l-4 border-l-amber-500',
    icon: HelpCircle,
  },
  cancelado: {
    label: 'Cancelado',
    badgeClass:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400',
    borderClass: 'border-l-4 border-l-slate-400',
    icon: XCircle,
  },
}

export default function Agenda() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { accountId } = useCurrentAccount()

  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')
  const [selectedCity, setSelectedCity] = useState<AppointmentCity | 'all'>('all')
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<AgendaSyncStatus | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  // Dialogs
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)

  // Patient Autocomplete no formulário de novo agendamento
  const [patientSuggestions, setPatientSuggestions] = useState<
    { name: string; phone: string; contactId?: string; convId?: string }[]
  >([])
  const [searchContactText, setSearchContactText] = useState('')
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)

  // Form State
  const [formData, setFormData] = useState<{
    patient_name: string
    patient_phone: string
    patient_id: string
    conversation_id: string
    doctor: string
    city: AppointmentCity
    location: string
    date: string
    startTime: string
    endTime: string
    appointment_type: string
    status: AppointmentStatus
    notes: string
  }>({
    patient_name: '',
    patient_phone: '',
    patient_id: '',
    conversation_id: '',
    doctor: 'Dr. Caio',
    city: 'Carmo do Rio Claro',
    location: 'Climed',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00',
    endTime: '10:00',
    appointment_type: 'Primeira consulta',
    status: 'agendado',
    notes: '',
  })

  // Carregar Status da Sincronia
  const loadSyncStatus = useCallback(async () => {
    try {
      const status = await getAgendaSyncStatus()
      setSyncStatus(status)
    } catch {
      /* intentionally ignored */
    }
  }, [])

  // Carregar Agendamentos do Período
  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true)
      let startDateIso: string
      let endDateIso: string

      if (viewMode === 'day') {
        startDateIso = startOfDay(currentDate).toISOString()
        endDateIso = endOfDay(currentDate).toISOString()
      } else {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
        startDateIso = startOfDay(weekStart).toISOString()
        endDateIso = endOfDay(weekEnd).toISOString()
      }

      const list = await listAppointments({
        startDate: startDateIso,
        endDate: endDateIso,
        city: selectedCity,
        status: selectedStatus,
      })

      setAppointments(list)
    } catch (err) {
      toast({
        title: 'Erro ao carregar agendamentos',
        description: err instanceof Error ? err.message : 'Falha ao buscar dados da agenda.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [currentDate, viewMode, selectedCity, selectedStatus, toast])

  useEffect(() => {
    loadAppointments()
    loadSyncStatus()
  }, [loadAppointments, loadSyncStatus])

  // Realtime subscription para appointments
  useEffect(() => {
    let isMounted = true
    const unsubscribe = pb
      .collection('appointments')
      .subscribe('*', () => {
        if (isMounted) {
          loadAppointments()
        }
      })
      .catch(() => {})

    return () => {
      isMounted = false
      unsubscribe.then((unsub) => {
        if (typeof unsub === 'function') unsub()
      })
    }
  }, [loadAppointments])

  // Forçar Sincronização Manual
  const handleManualSync = async () => {
    try {
      setIsSyncing(true)
      const res = await triggerAgendaSync()
      if (res.success) {
        toast({
          title: 'Sincronização concluída',
          description: `Puxados: ${res.pulled} | Enviados: ${res.pushed}`,
        })
      } else {
        toast({
          title: 'Aviso de sincronização',
          description: res.message || 'Verifique as configurações da agenda externa.',
          variant: 'destructive',
        })
      }
      await loadSyncStatus()
      await loadAppointments()
    } catch (err) {
      toast({
        title: 'Falha na sincronização',
        description:
          err instanceof Error ? err.message : 'Não foi possível sincronizar no momento.',
        variant: 'destructive',
      })
    } finally {
      setIsSyncing(false)
    }
  }

  // Busca rápida de contatos/conversas existentes para autocomplete
  useEffect(() => {
    if (!searchContactText.trim() || searchContactText.length < 2) {
      setPatientSuggestions([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearchingContacts(true)
        const query = searchContactText.trim()

        // Buscar em crm_contacts e conversations
        const [contactsRes, convsRes] = await Promise.allSettled([
          pb.collection('crm_contacts').getList(1, 6, {
            filter: `contact_name ~ "${query}" || push_name ~ "${query}" || phone ~ "${query}"`,
          }),
          pb.collection('conversations').getList(1, 6, {
            filter: `contact_name ~ "${query}" || push_name ~ "${query}" || contact_phone ~ "${query}"`,
          }),
        ])

        const map = new Map<
          string,
          { name: string; phone: string; contactId?: string; convId?: string }
        >()

        if (contactsRes.status === 'fulfilled' && contactsRes.value.items) {
          for (const item of contactsRes.value.items) {
            const name = item.contact_name || item.push_name || 'Paciente'
            const phone = item.phone || ''
            const key = `${name}_${phone}`
            map.set(key, { name, phone, contactId: item.id })
          }
        }

        if (convsRes.status === 'fulfilled' && convsRes.value.items) {
          for (const item of convsRes.value.items) {
            const name = item.contact_name || item.push_name || 'Paciente'
            const phone =
              item.contact_phone || (item.remote_jid ? item.remote_jid.split('@')[0] : '')
            const key = `${name}_${phone}`
            const existing = map.get(key)
            if (existing) {
              existing.convId = item.id
            } else {
              map.set(key, { name, phone, convId: item.id })
            }
          }
        }

        setPatientSuggestions(Array.from(map.values()))
      } catch {
        /* intentionally ignored */
      } finally {
        setIsSearchingContacts(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchContactText])

  // Salvar Novo Agendamento
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.patient_name.trim()) {
      toast({
        title: 'Campo obrigatório',
        description: 'Informe o nome do paciente.',
        variant: 'destructive',
      })
      return
    }

    try {
      const startsAtDate = new Date(`${formData.date}T${formData.startTime}:00`)
      const endsAtDate = new Date(`${formData.date}T${formData.endTime}:00`)

      if (isNaN(startsAtDate.getTime()) || isNaN(endsAtDate.getTime())) {
        toast({
          title: 'Data/hora inválida',
          description: 'Verifique os horários informados.',
          variant: 'destructive',
        })
        return
      }

      const input: CreateAppointmentInput = {
        patient_name: formData.patient_name.trim(),
        patient_phone: formData.patient_phone.trim(),
        patient_id: formData.patient_id || undefined,
        conversation_id: formData.conversation_id || undefined,
        doctor: formData.doctor.trim() || 'Dr. Caio',
        city: formData.city,
        location: formData.location || CITY_DEFAULT_LOCATIONS[formData.city],
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate.toISOString(),
        status: formData.status,
        appointment_type: formData.appointment_type.trim(),
        notes: formData.notes.trim(),
        account_id: accountId || undefined,
      }

      await createAppointment(input)

      toast({
        title: 'Agendamento criado',
        description: 'Consulta salva com sucesso e enfileirada para sincronização externa.',
      })

      setNewDialogOpen(false)
      setSearchContactText('')
      setFormData({
        patient_name: '',
        patient_phone: '',
        patient_id: '',
        conversation_id: '',
        doctor: 'Dr. Caio',
        city: 'Carmo do Rio Claro',
        location: 'Climed',
        date: format(currentDate, 'yyyy-MM-dd'),
        startTime: '09:00',
        endTime: '10:00',
        appointment_type: 'Primeira consulta',
        status: 'agendado',
        notes: '',
      })

      await loadAppointments()
    } catch (err) {
      toast({
        title: 'Erro ao criar agendamento',
        description: err instanceof Error ? err.message : 'Falha ao salvar no banco.',
        variant: 'destructive',
      })
    }
  }

  // Atualizar Status do Agendamento selecionado
  const handleUpdateStatus = async (newStatus: AppointmentStatus) => {
    if (!selectedAppointment) return
    try {
      const updated = await updateAppointment(selectedAppointment.id, {
        status: newStatus,
      })
      setSelectedAppointment(updated)
      toast({
        title: 'Status atualizado',
        description: `Agendamento marcado como "${STATUS_CONFIG[newStatus].label}".`,
      })
      await loadAppointments()
    } catch (err) {
      toast({
        title: 'Erro ao atualizar status',
        description: err instanceof Error ? err.message : 'Falha ao salvar alteração.',
        variant: 'destructive',
      })
    }
  }

  // Navegar para conversa no WhatsApp CRM
  const handleOpenConversation = (app: Appointment) => {
    if (app.conversation_id) {
      navigate(`/conversas?conversation_id=${app.conversation_id}`)
      return
    }
    if (app.patient_phone) {
      const digits = app.patient_phone.replace(/\D/g, '')
      navigate(`/conversas?phone=${digits}`)
      return
    }
    navigate('/conversas')
  }

  // Filtragem local por texto de busca
  const filteredAppointments = useMemo(() => {
    if (!searchQuery.trim()) return appointments
    const q = searchQuery.toLowerCase().trim()
    return appointments.filter((a) => {
      return (
        a.patient_name?.toLowerCase().includes(q) ||
        a.patient_phone?.includes(q) ||
        a.location?.toLowerCase().includes(q) ||
        a.appointment_type?.toLowerCase().includes(q) ||
        a.city?.toLowerCase().includes(q) ||
        a.doctor?.toLowerCase().includes(q)
      )
    })
  }, [appointments, searchQuery])

  // Agrupamento por dia na visão semanal
  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return []
    const start = startOfWeek(currentDate, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [currentDate, viewMode])

  // Formatação amigável do status de sincronia
  const syncBadge = useMemo(() => {
    if (!syncStatus) {
      return {
        label: 'Sincronia não iniciada',
        variant: 'secondary' as const,
        icon: HelpCircle,
        tooltip: 'Carregando status do serviço de sincronia...',
      }
    }

    if (syncStatus.last_status === 'missing_credentials') {
      return {
        label: 'Aguardando credenciais da agenda',
        variant: 'outline' as const,
        icon: AlertCircle,
        tooltip: 'Cadastre AGENDA_SYNC_URL, AGENDA_SYNC_EMAIL e AGENDA_SYNC_PASSWORD nos segredos.',
      }
    }

    if (
      syncStatus.last_status === 'auth_failed' ||
      syncStatus.last_status === 'connection_error' ||
      syncStatus.last_status === 'error'
    ) {
      return {
        label: 'Erro na sincronização',
        variant: 'destructive' as const,
        icon: AlertCircle,
        tooltip: syncStatus.last_error || 'Falha ao comunicar com o PocketBase da agenda externa.',
      }
    }

    if (syncStatus.last_sync) {
      try {
        const lastDate = parseISO(syncStatus.last_sync)
        const diffMinutes = Math.max(0, Math.round((Date.now() - lastDate.getTime()) / (1000 * 60)))
        const timeLabel =
          diffMinutes === 0 ? 'agora' : diffMinutes === 1 ? 'há 1 min' : `há ${diffMinutes} min`

        return {
          label: `Sincronizado ${timeLabel}`,
          variant: 'outline' as const,
          icon: CheckCircle2,
          tooltip: `Última sincronia com sucesso em ${format(lastDate, 'dd/MM/yyyy HH:mm:ss')}. Total local: ${syncStatus.total_appointments} agendamentos.`,
        }
      } catch {
        /* intentionally ignored */
      }
    }

    return {
      label: 'Sincronizado',
      variant: 'outline' as const,
      icon: CheckCircle2,
      tooltip: 'Sincronia ativa com o PocketBase da agenda externa.',
    }
  }, [syncStatus])

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-foreground">
              Agenda da Clínica
            </h1>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant={syncBadge.variant}
                    className="cursor-pointer gap-1.5 py-1 px-2.5 font-normal text-xs"
                    onClick={handleManualSync}
                  >
                    <syncBadge.icon className="w-3.5 h-3.5" />
                    <span>{syncBadge.label}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  {syncBadge.tooltip}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Clique para sincronizar agora.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão de consultas do Dr. Caio com sincronização bidirecional em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', isSyncing && 'animate-spin')} />
            <span className="hidden sm:inline">Sincronizar</span>
          </Button>

          <Button
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                date: format(currentDate, 'yyyy-MM-dd'),
              }))
              setNewDialogOpen(true)
            }}
            size="sm"
            className="gap-2 bg-primary text-primary-foreground shadow-sm ml-auto sm:ml-0"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Agendamento</span>
          </Button>
        </div>
      </div>

      {/* Alerta de credenciais faltantes com instruções claras */}
      {syncStatus?.last_status === 'missing_credentials' && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/20 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Sincronização com o projeto de Agenda externa aguardando credenciais
            </p>
            <p className="text-amber-800/90 dark:text-amber-300/80 text-xs leading-relaxed">
              A estrutura da agenda e o motor de sincronia estão 100% prontos neste CRM. Para
              conectar ao seu outro projeto Skip e sincronizar nos 2 lados, defina as variáveis de
              ambiente:{' '}
              <code className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded text-amber-900 font-mono text-[11px]">
                AGENDA_SYNC_URL
              </code>
              ,{' '}
              <code className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded text-amber-900 font-mono text-[11px]">
                AGENDA_SYNC_EMAIL
              </code>{' '}
              e{' '}
              <code className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded text-amber-900 font-mono text-[11px]">
                AGENDA_SYNC_PASSWORD
              </code>
              . Enquanto isso, agendamentos criados aqui funcionam perfeitamente e serão enviados
              assim que as chaves forem configuradas.
            </p>
          </div>
        </div>
      )}

      {/* Controles de Navegação, Filtros de Cidade e Busca */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-card p-4 rounded-2xl border border-border/60 shadow-sm">
        {/* Navegação de Datas */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => {
                const step = viewMode === 'day' ? 1 : 7
                setCurrentDate((d) => addDays(d, -step))
              }}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs font-medium"
              onClick={() => setCurrentDate(new Date())}
            >
              Hoje
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              onClick={() => {
                const step = viewMode === 'day' ? 1 : 7
                setCurrentDate((d) => addDays(d, step))
              }}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="font-medium text-sm sm:text-base flex items-center gap-2 pl-2 text-foreground">
            <CalendarIcon className="w-4 h-4 text-primary" />
            {viewMode === 'day' ? (
              <span>{format(currentDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}</span>
            ) : (
              <span>
                {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "dd 'de' MMM", {
                  locale: ptBR,
                })}{' '}
                -{' '}
                {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "dd 'de' MMM 'de' yyyy", {
                  locale: ptBR,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Alternador Dia / Semana e Busca */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar paciente, local..."
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select
            value={selectedStatus}
            onValueChange={(val) => setSelectedStatus(val as AppointmentStatus | 'all')}
          >
            <SelectTrigger className="h-9 w-36 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="agendado">Agendado</SelectItem>
              <SelectItem value="confirmado">Confirmado</SelectItem>
              <SelectItem value="realizado">Realizado</SelectItem>
              <SelectItem value="faltou">Faltou</SelectItem>
              <SelectItem value="remarcado">Remarcado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as 'day' | 'week')}
            className="w-auto"
          >
            <TabsList className="h-9">
              <TabsTrigger value="day" className="text-xs px-3">
                Dia
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-3">
                Semana
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Filtro de Cidades / Unidades */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {CITIES.map((c) => {
          const isSelected = selectedCity === c.id
          return (
            <button
              key={c.id}
              onClick={() => setSelectedCity(c.id)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background hover:bg-muted text-muted-foreground border-border',
              )}
            >
              <Building className="w-3.5 h-3.5" />
              <span>{c.label}</span>
              {c.id !== 'all' && (
                <span
                  className={cn(
                    'text-[10px] opacity-75 font-normal',
                    isSelected ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  ({c.location})
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Conteúdo Principal: Visão Dia ou Visão Semana */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">Carregando consultas da agenda...</p>
        </div>
      ) : filteredAppointments.length === 0 ? (
        <Card className="border-dashed border-2 p-12 text-center bg-card/50">
          <CalendarDays className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">Nenhum agendamento encontrado</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1 mb-6">
            Não há consultas marcadas para os filtros e datas selecionadas.
          </p>
          <Button
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                date: format(currentDate, 'yyyy-MM-dd'),
              }))
              setNewDialogOpen(true)
            }}
            className="gap-2 mx-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Agendamento</span>
          </Button>
        </Card>
      ) : viewMode === 'day' ? (
        /* VISÃO DIA */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAppointments.map((app) => {
            const statusConfig = STATUS_CONFIG[app.status] || STATUS_CONFIG.agendado
            const StatusIcon = statusConfig.icon
            const startTimeStr = format(parseISO(app.starts_at), 'HH:mm')
            const endTimeStr = format(parseISO(app.ends_at), 'HH:mm')

            return (
              <Card
                key={app.id}
                onClick={() => {
                  setSelectedAppointment(app)
                  setDetailsDialogOpen(true)
                }}
                className={cn(
                  'cursor-pointer hover:shadow-md transition-all duration-200 overflow-hidden bg-card border-border/80',
                  statusConfig.borderClass,
                )}
              >
                <CardHeader className="p-4 pb-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-base text-foreground leading-tight">
                        {app.patient_name}
                      </h4>
                      {app.appointment_type && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {app.appointment_type}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-[11px] gap-1', statusConfig.badgeClass)}
                    >
                      <StatusIcon className="w-3 h-3" />
                      <span>{statusConfig.label}</span>
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      {startTimeStr} - {endTimeStr}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      {app.city} ({app.location || CITY_DEFAULT_LOCATIONS[app.city]})
                    </span>
                  </div>

                  {app.notes && (
                    <p className="text-xs text-muted-foreground/90 line-clamp-2 bg-muted/40 p-2 rounded-lg">
                      {app.notes}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-border/60">
                    <div className="flex items-center gap-1.5">
                      {app.source === 'agenda_externa' ? (
                        <Badge variant="secondary" className="text-[10px] font-normal py-0">
                          Agenda Externa
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-normal py-0">
                          CRM
                        </Badge>
                      )}
                      {app.sync_error && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              Push pendente: {app.sync_error}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenConversation(app)
                      }}
                      className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        /* VISÃO SEMANA */
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const isToday = isSameDay(day, new Date())
            const dayAppointments = filteredAppointments.filter((a) =>
              isSameDay(parseISO(a.starts_at), day),
            )

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'rounded-xl border p-2.5 flex flex-col min-h-[350px] bg-card/60 transition-colors',
                  isToday ? 'border-primary/50 bg-primary/[0.02]' : 'border-border',
                )}
              >
                <div className="text-center pb-2 border-b border-border/60 mb-2">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">
                    {format(day, 'EEE', { locale: ptBR })}
                  </p>
                  <p
                    className={cn(
                      'text-sm font-semibold rounded-full w-7 h-7 mx-auto flex items-center justify-center mt-0.5',
                      isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    )}
                  >
                    {format(day, 'dd')}
                  </p>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto">
                  {dayAppointments.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/60 text-center pt-8">
                      Sem horários
                    </p>
                  ) : (
                    dayAppointments.map((app) => {
                      const statusConfig = STATUS_CONFIG[app.status] || STATUS_CONFIG.agendado
                      const startTimeStr = format(parseISO(app.starts_at), 'HH:mm')

                      return (
                        <div
                          key={app.id}
                          onClick={() => {
                            setSelectedAppointment(app)
                            setDetailsDialogOpen(true)
                          }}
                          className={cn(
                            'p-2 rounded-lg border bg-card hover:shadow-sm cursor-pointer transition-all text-left space-y-1',
                            statusConfig.borderClass,
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-foreground">
                              {startTimeStr}
                            </span>
                            <span
                              className={cn(
                                'text-[9px] px-1.5 py-0.2 rounded-full font-medium',
                                statusConfig.badgeClass,
                              )}
                            >
                              {app.status}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-foreground truncate">
                            {app.patient_name}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">{app.city}</p>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* DIALOG: NOVO AGENDAMENTO */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">Novo Agendamento</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateAppointment} className="space-y-4 pt-2">
            {/* Paciente com Autocomplete */}
            <div className="space-y-1.5 relative">
              <Label htmlFor="patient_name">Nome do Paciente *</Label>
              <Input
                id="patient_name"
                value={formData.patient_name}
                onChange={(e) => {
                  const val = e.target.value
                  setFormData((prev) => ({ ...prev, patient_name: val }))
                  setSearchContactText(val)
                }}
                placeholder="Ex: Maria Silva"
                required
              />

              {/* Sugestões do Autocomplete */}
              {patientSuggestions.length > 0 && searchContactText && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-xl shadow-lg p-1.5 max-h-48 overflow-y-auto">
                  <p className="text-[10px] text-muted-foreground px-2 py-1 font-medium">
                    Pacientes encontrados no CRM / WhatsApp:
                  </p>
                  {patientSuggestions.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          patient_name: item.name,
                          patient_phone: item.phone,
                          patient_id: item.contactId || '',
                          conversation_id: item.convId || '',
                        }))
                        setPatientSuggestions([])
                        setSearchContactText('')
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs hover:bg-muted cursor-pointer flex items-center justify-between"
                    >
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-muted-foreground text-[11px]">{item.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Telefone */}
            <div className="space-y-1.5">
              <Label htmlFor="patient_phone">Telefone / WhatsApp</Label>
              <Input
                id="patient_phone"
                value={formData.patient_phone}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, patient_phone: e.target.value }))
                }
                placeholder="(35) 99999-9999"
              />
            </div>

            {/* Cidade e Local */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Select
                  value={formData.city}
                  onValueChange={(val: AppointmentCity) => {
                    setFormData((prev) => ({
                      ...prev,
                      city: val,
                      location: CITY_DEFAULT_LOCATIONS[val] || 'Climed',
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Carmo do Rio Claro">Carmo do Rio Claro</SelectItem>
                    <SelectItem value="Alfenas">Alfenas</SelectItem>
                    <SelectItem value="Monte Belo">Monte Belo</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="location">Local / Clínica</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Ex: Climed"
                />
              </div>
            </div>

            {/* Data e Horários */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="app_date">Data</Label>
                <Input
                  id="app_date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app_start">Início</Label>
                <Input
                  id="app_start"
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => setFormData((prev) => ({ ...prev, startTime: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app_end">Término</Label>
                <Input
                  id="app_end"
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => setFormData((prev) => ({ ...prev, endTime: e.target.value }))}
                  required
                />
              </div>
            </div>

            {/* Tipo de Consulta e Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="app_type">Tipo de Atendimento</Label>
                <Input
                  id="app_type"
                  value={formData.appointment_type}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, appointment_type: e.target.value }))
                  }
                  placeholder="Ex: Primeira consulta, retorno, bioimpedância"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(val: AppointmentStatus) =>
                    setFormData((prev) => ({ ...prev, status: val }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agendado">Agendado</SelectItem>
                    <SelectItem value="confirmado">Confirmado</SelectItem>
                    <SelectItem value="realizado">Realizado</SelectItem>
                    <SelectItem value="faltou">Faltou</SelectItem>
                    <SelectItem value="remarcado">Remarcado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label htmlFor="app_notes">Observações</Label>
              <Textarea
                id="app_notes"
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Detalhes relevantes, sintomas relatados..."
                rows={2}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setNewDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar Agendamento</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: DETALHES DO AGENDAMENTO */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        {selectedAppointment && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center justify-between pr-4">
                <DialogTitle className="font-serif text-xl">
                  {selectedAppointment.patient_name}
                </DialogTitle>
                <Badge
                  variant="outline"
                  className={cn('text-xs', STATUS_CONFIG[selectedAppointment.status]?.badgeClass)}
                >
                  {STATUS_CONFIG[selectedAppointment.status]?.label || selectedAppointment.status}
                </Badge>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/40">
                <div>
                  <span className="text-xs text-muted-foreground block">Data e Horário</span>
                  <span className="font-medium text-foreground">
                    {format(parseISO(selectedAppointment.starts_at), "dd/MM/yyyy 'às' HH:mm")}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Profissional</span>
                  <span className="font-medium text-foreground">
                    {selectedAppointment.doctor || 'Dr. Caio'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Cidade / Unidade</span>
                  <span className="font-medium text-foreground">
                    {selectedAppointment.city} ({selectedAppointment.location || 'Clínica'})
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Tipo</span>
                  <span className="font-medium text-foreground">
                    {selectedAppointment.appointment_type || 'Consulta'}
                  </span>
                </div>
              </div>

              {selectedAppointment.patient_phone && (
                <div className="flex items-center justify-between p-3 rounded-xl border">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span className="text-foreground font-mono text-xs">
                      {selectedAppointment.patient_phone}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDetailsDialogOpen(false)
                      handleOpenConversation(selectedAppointment)
                    }}
                    className="gap-1.5 h-8 text-xs text-primary"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Abrir conversa
                  </Button>
                </div>
              )}

              {selectedAppointment.notes && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-medium">Observações</span>
                  <p className="text-xs bg-muted/30 p-2.5 rounded-lg text-foreground/90">
                    {selectedAppointment.notes}
                  </p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t">
                <span className="text-xs text-muted-foreground font-medium block">
                  Alterar Status Rápido:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      'agendado',
                      'confirmado',
                      'realizado',
                      'faltou',
                      'cancelado',
                    ] as AppointmentStatus[]
                  ).map((st) => (
                    <Button
                      key={st}
                      size="sm"
                      variant={selectedAppointment.status === st ? 'default' : 'outline'}
                      onClick={() => handleUpdateStatus(st)}
                      className="text-xs h-7 px-2.5"
                    >
                      {STATUS_CONFIG[st].label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground/75 pt-2 flex items-center justify-between border-t">
                <span>
                  Origem:{' '}
                  {selectedAppointment.source === 'crm'
                    ? 'Criado no CRM'
                    : 'Sincronizado da Agenda'}
                </span>
                {selectedAppointment.last_synced_at && (
                  <span>
                    Sync: {format(parseISO(selectedAppointment.last_synced_at), 'dd/MM HH:mm')}
                  </span>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
