import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  User,
  Phone,
  Calendar,
  HeartPulse,
  Tag,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Loader2,
  Sparkles,
  CalendarCheck,
  CalendarX,
  AlertTriangle,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { CrmContact, Task, Appointment, Notification } from '@/types/models'
import pb from '@/lib/pocketbase/client'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { getCareCategoryMeta, getPriorityMeta, getStatusMeta } from '@/lib/task-meta'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { extractBrlBudgetFromText } from '@/services/crm_service'
import { listAppointments } from '@/services/appointments'
import { ptBR } from 'date-fns/locale'
import {
  formatBrazilianDate,
  formatTimeSaoPaulo,
  getWeekdayLongSaoPaulo,
  formatRecentActivityDate,
} from '@/lib/datetime'
import { PatientBirthDateBadge } from '@/components/PatientBirthDateBadge'

interface PatientContextPanelProps {
  open: boolean
  onClose: () => void
  remoteJid: string
  conversationId?: string
  contactName?: string
  instanceName?: string
  onOpenAddToCrm?: () => void
  onOpenSchedule?: () => void
}

/** Formata texto legível do tipo: "terça-feira 15/09 às 14:00" */
function formatAppointmentDateTimeLabel(isoString: string): string {
  if (!isoString) return ''
  const weekday = getWeekdayLongSaoPaulo(isoString)
  const dateBR = formatBrazilianDate(isoString, false)
  const time = formatTimeSaoPaulo(isoString)
  return `${weekday} ${dateBR} às ${time}`
}

export function PatientContextPanel({
  open,
  onClose,
  remoteJid,
  conversationId,
  contactName,
  instanceName,
  onOpenAddToCrm,
  onOpenSchedule,
}: PatientContextPanelProps) {
  const [loading, setLoading] = useState(false)
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [patientAppointments, setPatientAppointments] = useState<Appointment[]>([])
  const [conversationNotifications, setConversationNotifications] = useState<Notification[]>([])
  const [detectedBudget, setDetectedBudget] = useState<{ value: number; matched: string } | null>(
    null,
  )
  const [isSavingBudget, setIsSavingBudget] = useState(false)

  useEffect(() => {
    if (!open || !remoteJid) return

    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      try {
        const cleanPhone = remoteJid.split('@')[0]

        // Buscar contato no CRM (consulta única e indexada)
        const contacts = await pb.collection('crm_contacts').getFullList<CrmContact>({
          filter: `jid = "${remoteJid}" || phone ~ "${cleanPhone}"`,
          expand: 'stage_id,company_id',
          sort: '-created',
          requestKey: null,
        })

        if (cancelled) return

        const foundContact = contacts.length > 0 ? contacts[0] : null
        setContact(foundContact)

        // Montar filtro de notificações relevantes vinculadas à conversa e/ou contato
        const notifFilterParts: string[] = []
        if (conversationId) {
          notifFilterParts.push(`conversation_id = "${conversationId}"`)
        }
        if (foundContact?.id) {
          notifFilterParts.push(`crm_contact_id = "${foundContact.id}"`)
        }

        // Executar chamadas em lote paralelo com requestKey=null (sem cascata de re-queries)
        const fetchTasksPromise = foundContact?.id
          ? pb.collection('tasks').getFullList<Task>({
              filter: `crm_contact_id = "${foundContact.id}"`,
              sort: '-created',
              requestKey: null,
            })
          : Promise.resolve([] as Task[])

        const fetchApptsPromise = listAppointments({
          patient_phone: foundContact?.phone || cleanPhone,
          patient_id: foundContact?.id,
        })

        const fetchNotifsPromise =
          notifFilterParts.length > 0
            ? pb.collection('notifications').getFullList<Notification>({
                filter: notifFilterParts.join(' || '),
                sort: '-created',
                requestKey: null,
              })
            : Promise.resolve([] as Notification[])

        try {
          const [taskList, appts, notifs] = await Promise.all([
            fetchTasksPromise,
            fetchApptsPromise,
            fetchNotifsPromise,
          ])

          if (!cancelled) {
            setTasks(taskList)
            setPatientAppointments(appts)
            setConversationNotifications(notifs)
          }
        } catch {
          /* intentionally ignored */
        }

        // Buscar mensagens recentes para detectar menções de orçamento BRL (se contato não tiver budget já salvo)
        if (!foundContact?.budget_value && remoteJid) {
          try {
            const recentMsgs = await pb.collection('whatsapp_messages').getList(1, 15, {
              filter: `remote_jid = "${remoteJid}"`,
              sort: '-timestamp',
              requestKey: null,
            })
            if (!cancelled && recentMsgs.items.length > 0) {
              for (const m of recentMsgs.items) {
                const text = (m as any).content || ''
                const extracted = extractBrlBudgetFromText(text)
                if (extracted) {
                  setDetectedBudget(extracted)
                  break
                }
              }
            }
          } catch {
            /* ignore */
          }
        } else {
          setDetectedBudget(null)
        }
      } catch (err) {
        if (!cancelled) setContact(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
  }, [open, remoteJid, conversationId, instanceName])

  // Identificar próximo agendamento ativo e histórico dos últimos 2 meses (memoizado incondicionalmente)
  const nowIso = useMemo(() => new Date().toISOString(), [])
  const twoMonthsAgo = useMemo(
    () => new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  )

  const upcomingAppointment = useMemo(() => {
    return patientAppointments
      .filter((a) => a.starts_at >= nowIso && a.status !== 'cancelado')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
  }, [patientAppointments, nowIso])

  const pastAppointments2Months = useMemo(() => {
    return patientAppointments
      .filter(
        (a) => a.starts_at < nowIso && a.starts_at >= twoMonthsAgo && a.status !== 'cancelado',
      )
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  }, [patientAppointments, nowIso, twoMonthsAgo])

  // Identificar agendamentos originados / confirmados automaticamente pela conversa
  const autoConfirmedAppointments = useMemo(() => {
    return patientAppointments
      .filter((a) => {
        const isAuto =
          a.last_interaction_type === 'confirmado_paciente' ||
          (a.source === 'crm' && (a.notes || '').includes('WhatsApp')) ||
          (a.notes || '').toLowerCase().includes('confirmado automaticamente')
        return isAuto && a.status !== 'cancelado'
      })
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  }, [patientAppointments])

  // Notificações de confirmação e agendamento geradas pelo webhook da conversa
  const autoCreatedNotifs = useMemo(() => {
    return conversationNotifications.filter((n) => {
      const title = n.title || ''
      return (
        title.includes('Consulta confirmada pelo paciente') ||
        title.includes('Consulta agendada pela confirmação do paciente')
      )
    })
  }, [conversationNotifications])

  // Notificações de cancelamento de agendamento pelo paciente
  const cancelledByPatientNotifs = useMemo(() => {
    return conversationNotifications.filter((n) => {
      const title = n.title || ''
      const body = n.body || ''
      return (
        title.includes('Consulta cancelada pelo paciente') ||
        (title.includes('cancelada') && body.includes('removido da agenda'))
      )
    })
  }, [conversationNotifications])

  // Notificações de reagendamento solicitado
  const reschedNotifs = useMemo(() => {
    return conversationNotifications.filter((n) => {
      const title = n.title || ''
      return title.includes('solicitou reagendamento')
    })
  }, [conversationNotifications])

  // Notificações de dados incompletos para agendamento
  const missingDataNotifs = useMemo(() => {
    return conversationNotifications.filter((n) => {
      const title = n.title || ''
      return title.includes('Agendamento pendente de dados')
    })
  }, [conversationNotifications])

  if (!open) return null

  const displayName = resolveDisplayName(
    contact?.contact_name || contactName,
    contact?.jid || remoteJid,
    contact?.push_name,
  )
  const displayPhone = formatPhoneBR(contact?.phone || remoteJid)

  const careMeta = contact?.care_status ? getCareCategoryMeta(contact.care_status) : null

  const handleConfirmBudget = async () => {
    if (!contact?.id || !detectedBudget || isSavingBudget) return
    setIsSavingBudget(true)
    try {
      const nowIso = new Date().toISOString()
      const updated = await pb.collection('crm_contacts').update<CrmContact>(
        contact.id,
        {
          budget_value: detectedBudget.value,
          budget_sent_at: nowIso,
        },
        { requestKey: null },
      )
      setContact(updated)
      setDetectedBudget(null)
      toast.success(
        `Orçamento de R$ ${detectedBudget.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} confirmado no cadastro!`,
      )
    } catch (err: any) {
      toast.error('Erro ao salvar orçamento: ' + (err?.message || 'tente novamente'))
    } finally {
      setIsSavingBudget(false)
    }
  }

  return (
    <aside className="fixed inset-0 md:static md:inset-auto md:w-80 w-full bg-white flex flex-col h-full z-50 md:z-20 border-l border-border shadow-lg md:shadow-sm shrink-0 animate-in slide-in-from-right duration-200">
      {/* Cabeçalho do Painel */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-white shrink-0 min-h-[56px]">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-rose-600" />
          <h3 className="font-semibold text-foreground text-sm md:text-base">
            Contexto do Paciente
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-10 w-10 min-h-[44px] min-w-[44px] rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Fechar contexto do paciente"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs">Carregando dados do CRM...</span>
          </div>
        ) : !contact ? (
          <div className="text-center py-8 px-2 space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <User className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">{displayName}</p>
              <p className="text-xs text-muted-foreground">{displayPhone}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Este paciente ainda não está cadastrado na base do CRM.
            </p>

            {/* Se houver alertas da automação mesmo antes de cadastrado no CRM */}
            {(autoConfirmedAppointments.length > 0 ||
              autoCreatedNotifs.length > 0 ||
              cancelledByPatientNotifs.length > 0) && (
              <div className="text-left space-y-2 pt-2">
                {autoConfirmedAppointments.length > 0 && (
                  <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs space-y-1.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-teal-900 dark:text-teal-200 font-semibold">
                      <CalendarCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      <span>Agendamento via WhatsApp</span>
                    </div>
                    <p className="text-teal-950 dark:text-teal-100 font-medium leading-snug">
                      Agendamento criado pela confirmação do paciente:{' '}
                      {formatAppointmentDateTimeLabel(autoConfirmedAppointments[0].starts_at)},{' '}
                      {autoConfirmedAppointments[0].location || autoConfirmedAppointments[0].city}
                    </p>
                  </div>
                )}

                {cancelledByPatientNotifs.map((notif) => (
                  <div
                    key={notif.id}
                    className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs space-y-1.5 shadow-sm"
                  >
                    <div className="flex items-center gap-1.5 text-rose-900 dark:text-rose-200 font-semibold">
                      <CalendarX className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      <span>Agendamento cancelado pelo paciente</span>
                    </div>
                    <p className="text-rose-950 dark:text-rose-100 font-normal leading-snug">
                      {notif.body ||
                        'Consulta cancelada pelo paciente no WhatsApp e removida da agenda.'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {onOpenAddToCrm && (
              <Button
                size="sm"
                onClick={onOpenAddToCrm}
                className="w-full min-h-[44px] bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium mt-2"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Adicionar ao CRM
              </Button>
            )}
          </div>
        ) : (
          <div className="contents">
            {/* SEÇÃO DE VISIBILIDADE DE AUTOMAÇÃO VIA CONVERSA (Fabiana Humana) */}
            {/* 1. Alerta de Agendamento Confirmado / Criado Automaticamente na Conversa */}
            {autoConfirmedAppointments.length > 0 && (
              <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between text-teal-900 dark:text-teal-200 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CalendarCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                    Agendamento via Conversa
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200 border-teal-300 dark:border-teal-700 flex items-center gap-1 py-0 h-5 font-medium"
                  >
                    <Bot className="w-3 h-3" />
                    Automático
                  </Badge>
                </div>
                <p className="text-teal-950 dark:text-teal-100 font-medium leading-snug">
                  Agendamento criado pela confirmação do paciente:{' '}
                  {formatAppointmentDateTimeLabel(autoConfirmedAppointments[0].starts_at)},{' '}
                  {autoConfirmedAppointments[0].location || autoConfirmedAppointments[0].city}
                </p>
                <p className="text-[11px] text-teal-700 dark:text-teal-400">
                  {autoConfirmedAppointments[0].appointment_type || 'Consulta'} com Dr. Caio
                  {autoConfirmedAppointments[0].created
                    ? ` • Registrado ${formatRecentActivityDate(autoConfirmedAppointments[0].created, true)}`
                    : ''}
                </p>
              </div>
            )}

            {/* 2. Alerta de Cancelamento pelo Paciente na Conversa */}
            {cancelledByPatientNotifs.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between text-rose-900 dark:text-rose-200 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CalendarX className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                    Cancelado no WhatsApp
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700 py-0 h-5 font-medium"
                  >
                    Removido da Agenda
                  </Badge>
                </div>
                {cancelledByPatientNotifs.slice(0, 2).map((notif) => (
                  <div key={notif.id} className="space-y-0.5">
                    <p className="text-rose-950 dark:text-rose-100 font-medium leading-snug">
                      Agendamento cancelado pelo paciente: {notif.body || notif.title}
                    </p>
                    {notif.created && (
                      <p className="text-[10px] text-rose-600 dark:text-rose-400">
                        {formatRecentActivityDate(notif.created, true)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 3. Alerta de Pedido de Reagendamento */}
            {reschedNotifs.length > 0 && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between text-indigo-900 dark:text-indigo-200 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    Pedido de Reagendamento
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700 py-0 h-5 font-medium"
                  >
                    Tarefa Criada
                  </Badge>
                </div>
                {reschedNotifs.slice(0, 1).map((notif) => (
                  <p
                    key={notif.id}
                    className="text-indigo-950 dark:text-indigo-100 font-normal leading-snug"
                  >
                    {notif.body || 'Paciente solicitou alteração de horário/dia na conversa.'}
                  </p>
                ))}
              </div>
            )}

            {/* 4. Alerta de Confirmação com Dados Faltantes */}
            {missingDataNotifs.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between text-amber-900 dark:text-amber-200 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    Dados Faltantes para Agendar
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 py-0 h-5 font-medium"
                  >
                    Atenção
                  </Badge>
                </div>
                {missingDataNotifs.slice(0, 1).map((notif) => (
                  <p
                    key={notif.id}
                    className="text-amber-950 dark:text-amber-100 font-normal leading-snug"
                  >
                    {notif.body || 'Paciente tentou agendar mas faltam horário, dia ou local.'}
                  </p>
                ))}
              </div>
            )}

            {/* Banner de Próximo Agendamento Geral / Status de Cuidado */}
            {upcomingAppointment ? (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-300 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Próxima Consulta Agendada
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-0"
                  >
                    {upcomingAppointment.appointment_type || 'Consulta'}
                  </Badge>
                </div>
                <p className="text-emerald-900 dark:text-emerald-100 font-medium">
                  {formatBrazilianDate(upcomingAppointment.starts_at)} às{' '}
                  {formatTimeSaoPaulo(upcomingAppointment.starts_at)}
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  {upcomingAppointment.location || upcomingAppointment.city} • Dr. Caio
                </p>
              </div>
            ) : pastAppointments2Months.length > 0 ? (
              <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Cuidado em dia (atendido recentemente)
                  </div>
                  {onOpenSchedule && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenSchedule}
                      className="h-7 text-xs px-2.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border-emerald-300 font-medium"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Novo agendamento
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Atendimento realizado recentemente na agenda (
                  {formatBrazilianDate(pastAppointments2Months[0].starts_at)}). Sem pendências em
                  aberto.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-semibold">
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    Sem agendamento ativo
                  </div>
                  {onOpenSchedule && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onOpenSchedule}
                      className="h-7 text-xs px-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 font-medium"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Agendar
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Paciente precisa de cuidado/recall. Ofereça Consulta, Retorno ou Consultoria.
                </p>
              </div>
            )}

            {/* Banner de Orçamento Detectado (NUNCA gravação automática: confirmação com 1 clique) */}
            {detectedBudget && !contact.budget_value && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800 text-xs space-y-2 shadow-xs animate-in fade-in">
                <div className="flex items-center justify-between text-emerald-900 dark:text-emerald-200 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    Orçamento Detectado
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300"
                  >
                    {detectedBudget.matched}
                  </Badge>
                </div>
                <p className="text-emerald-950 dark:text-emerald-100 leading-snug">
                  Valor mencionado na conversa recente:{' '}
                  <strong className="text-emerald-900 font-bold">
                    R$ {detectedBudget.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </strong>
                  . Deseja registrar no contato para as réguas automáticas?
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={handleConfirmBudget}
                    disabled={isSavingBudget}
                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md px-3"
                  >
                    {isSavingBudget ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    )}
                    Confirmar R$ {detectedBudget.value.toLocaleString('pt-BR')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDetectedBudget(null)}
                    disabled={isSavingBudget}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Ignorar
                  </Button>
                </div>
              </div>
            )}

            {/* Informações Básicas do Paciente */}
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border">
                {contact.avatar ? (
                  <AvatarImage src={pb.files.getUrl(contact, contact.avatar)} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {displayName.charAt(0).toUpperCase() || 'P'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-base leading-tight truncate">{displayName}</h4>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" />
                  {displayPhone}
                </p>
                <div className="mt-1.5">
                  <PatientBirthDateBadge birthDate={contact.birth_date} />
                </div>
              </div>
            </div>

            {/* Motivo do Contato (Fora de Horário / Recepção) */}
            {contact.contact_reason && (
              <div className="p-3 rounded-lg bg-indigo-50/80 border border-indigo-200/80 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-indigo-900 font-semibold flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-indigo-600" />
                    Motivo do Contato
                  </span>
                  {contact.contact_reason_category && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-4.5 px-2 font-medium bg-indigo-100 text-indigo-800 border-indigo-300 capitalize"
                    >
                      {contact.contact_reason_category}
                    </Badge>
                  )}
                </div>
                <p className="text-indigo-950 font-normal leading-relaxed italic bg-white/60 p-2 rounded border border-indigo-100">
                  &quot;{contact.contact_reason}&quot;
                </p>
              </div>
            )}

            <Separator />

            {/* Orçamento já cadastrado no contato */}
            {contact.budget_value ? (
              <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs flex items-center justify-between">
                <div>
                  <span className="text-emerald-800 font-medium block">Orçamento Registrado</span>
                  <span className="text-xs text-muted-foreground">
                    {contact.budget_sent_at
                      ? `Enviado em ${formatBrazilianDate(contact.budget_sent_at)}`
                      : 'Data não informada'}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="bg-emerald-100 text-emerald-900 border-emerald-300 font-bold text-xs py-0.5"
                >
                  R${' '}
                  {Number(contact.budget_value).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}
                </Badge>
              </div>
            ) : null}

            {/* Estágio do Pipeline & Cuidado */}
            <div className="space-y-2.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Status no CRM
              </span>
              <div className="flex flex-wrap gap-2">
                {contact.expand?.stage_id ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-medium bg-primary/5 text-primary border-primary/20"
                  >
                    <Tag className="w-3 h-3 mr-1" />
                    {contact.expand.stage_id.label ||
                      contact.expand.stage_id.title ||
                      contact.stage}
                  </Badge>
                ) : contact.stage ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-medium bg-primary/5 text-primary border-primary/20"
                  >
                    <Tag className="w-3 h-3 mr-1" />
                    {contact.stage}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Sem estágio definido
                  </Badge>
                )}

                {careMeta && (
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium border-transparent ${careMeta.color}`}
                  >
                    <span className="mr-1">{careMeta.emoji}</span>
                    {careMeta.label}
                  </Badge>
                )}
              </div>
            </div>

            {/* Data da Última Conversão / Consulta */}
            {contact.converted_at && (
              <div className="p-3 rounded-lg bg-muted/40 border text-xs space-y-1">
                <span className="text-muted-foreground flex items-center gap-1 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  Data de Conversão:
                </span>
                <p className="font-semibold text-foreground">
                  {format(new Date(contact.converted_at), "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            )}

            {/* Sugestão da IA */}
            {contact.ai_suggested_action && (
              <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-xs space-y-1">
                <span className="text-purple-800 flex items-center gap-1 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  Ação Sugerida pela IA:
                </span>
                <p className="text-purple-900 leading-relaxed">{contact.ai_suggested_action}</p>
              </div>
            )}

            {/* Histórico dos Últimos 2 Meses (Espelhamento da Agenda) */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Histórico (Últimos 2 Meses - {pastAppointments2Months.length})
              </span>
              {pastAppointments2Months.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">
                  Nenhum atendimento registrado nos últimos 2 meses.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {pastAppointments2Months.slice(0, 4).map((apt) => (
                    <div
                      key={apt.id}
                      className="p-2 rounded-md border bg-muted/20 text-xs flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">
                            {formatBrazilianDate(apt.starts_at)} {formatTimeSaoPaulo(apt.starts_at)}
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              (apt.appointment_type || '').toLowerCase().includes('retorno')
                                ? 'bg-amber-50 text-amber-800 border-amber-200 text-[9px] py-0'
                                : (apt.appointment_type || '').toLowerCase().includes('consultoria')
                                  ? 'bg-purple-50 text-purple-800 border-purple-200 text-[9px] py-0'
                                  : 'bg-blue-50 text-blue-800 border-blue-200 text-[9px] py-0'
                            }
                          >
                            {apt.appointment_type || 'Consulta'}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {apt.location || apt.city} • Status: {apt.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Tarefas Vinculadas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tarefas ({tasks.length})
                </span>
              </div>
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  Nenhuma tarefa vinculada a este paciente.
                </p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => {
                    const statusMeta = getStatusMeta(task.status)
                    const prioMeta = getPriorityMeta(task.priority)
                    return (
                      <div
                        key={task.id}
                        className="p-2.5 rounded-lg border bg-background hover:bg-muted/40 transition-colors text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground line-clamp-1">
                            {task.title}
                          </span>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dot}`} />
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{prioMeta.label}</span>
                          <span>•</span>
                          <span>{statusMeta.label}</span>
                          {task.due_date && (
                            <span className="inline-flex items-center gap-2">
                              <span>•</span>
                              <span>Venc: {format(new Date(task.due_date), 'dd/MM')}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
