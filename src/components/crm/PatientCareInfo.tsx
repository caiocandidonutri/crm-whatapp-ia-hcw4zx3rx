import { useState, useEffect } from 'react'
import { Heart, MessageCircle, Calendar, Activity, Clock, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import pb from '@/lib/pocketbase/client'
import { CrmContact, Appointment } from '@/types/models'
import { listAppointments } from '@/services/appointments'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface PatientCareInfoProps {
  contact: CrmContact
}

export function PatientCareInfo({ contact }: PatientCareInfoProps) {
  const [totalInteractions, setTotalInteractions] = useState(0)
  const [loading, setLoading] = useState(true)
  const [appointments, setAppointments] = useState<Appointment[]>([])

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      setLoading(true)
      try {
        const promises: Promise<any>[] = []

        if (contact?.jid && contact?.instance_name) {
          promises.push(
            pb
              .collection('whatsapp_messages')
              .getList(1, 1, {
                filter: `remote_jid = '${contact.jid}' && instance_name = '${contact.instance_name}'`,
                requestKey: null,
              })
              .then((res) => {
                if (!cancelled) setTotalInteractions(res.totalItems)
              })
              .catch(() => {}),
          )
        }

        // Carregar agendamentos do paciente (pelo ID ou telefone)
        promises.push(
          listAppointments({
            patient_id: contact.id,
            patient_phone: contact.phone,
          })
            .then((appts) => {
              if (!cancelled) setAppointments(appts)
            })
            .catch(() => {}),
        )

        await Promise.all(promises)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [contact?.id, contact?.phone, contact?.jid, contact?.instance_name])

  const careStatus = contact.care_status || 'em_dia'
  const statusLabel =
    careStatus === 'precisa_retorno'
      ? 'Precisa de retorno'
      : careStatus.startsWith('sem_contato')
        ? careStatus.replace('sem_contato_', 'Sem contato há ').replace('_dias', ' dias')
        : 'Em dia'

  const statusColor =
    careStatus === 'em_dia'
      ? 'bg-emerald-100 text-emerald-700'
      : careStatus === 'precisa_retorno'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-rose-100 text-rose-700'

  const nowIso = new Date().toISOString()
  const upcomingAppointment = appointments
    .filter((a) => a.starts_at >= nowIso && a.status !== 'cancelado')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]

  const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const pastAppointments2Months = appointments
    .filter((a) => a.starts_at < nowIso && a.starts_at >= twoMonthsAgo && a.status !== 'cancelado')
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Espelhamento & Cuidado do Paciente
      </h3>

      {/* Próximo agendamento ativo */}
      {upcomingAppointment ? (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs space-y-1">
          <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-300 font-semibold">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Consulta Ativa Agendada
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] bg-emerald-100 text-emerald-800 border-0"
            >
              {upcomingAppointment.appointment_type || 'Consulta'}
            </Badge>
          </div>
          <p className="text-emerald-900 font-medium">
            {format(new Date(upcomingAppointment.starts_at), "dd 'de' MMMM 'às' HH:mm", {
              locale: ptBR,
            })}
          </p>
          <p className="text-[11px] text-emerald-700">
            {upcomingAppointment.location || upcomingAppointment.city} • Dr. Caio
          </p>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-amber-800 font-semibold">
            <Clock className="w-4 h-4 text-amber-600" />
            Nenhuma consulta agendada
          </div>
          <p className="text-[11px] text-amber-700">
            Paciente sem agendamento futuro no sistema. Ideal para recall / oferecer consulta,
            retorno ou consultoria.
          </p>
        </div>
      )}

      {/* Atendimentos nos últimos 2 meses */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Histórico (Últimos 2 Meses - {pastAppointments2Months.length})
        </p>
        {pastAppointments2Months.length === 0 ? (
          <p className="text-xs text-muted-foreground italic bg-muted/20 p-2.5 rounded-lg">
            Nenhuma consulta realizada nos últimos 2 meses.
          </p>
        ) : (
          <div className="space-y-1.5">
            {pastAppointments2Months.slice(0, 3).map((apt) => (
              <div
                key={apt.id}
                className="p-2.5 rounded-lg border bg-background text-xs flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">
                      {format(new Date(apt.starts_at), 'dd/MM/yyyy HH:mm')}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        (apt.appointment_type || '').toLowerCase().includes('retorno')
                          ? 'bg-amber-50 text-amber-800 border-amber-200 text-[10px] py-0'
                          : (apt.appointment_type || '').toLowerCase().includes('consultoria')
                            ? 'bg-purple-50 text-purple-800 border-purple-200 text-[10px] py-0'
                            : 'bg-blue-50 text-blue-800 border-blue-200 text-[10px] py-0'
                      }
                    >
                      {apt.appointment_type || 'Consulta'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {apt.location || apt.city} • Status: {apt.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2.5">
          <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Status de cuidado</p>
            {loading ? (
              <Skeleton className="h-4 w-20 mt-0.5" />
            ) : (
              <Badge className={cn('text-[10px] border-0 mt-0.5', statusColor)}>
                {statusLabel}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2.5">
          <MessageCircle className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Total de interações</p>
            {loading ? (
              <Skeleton className="h-4 w-10 mt-0.5" />
            ) : (
              <p className="text-sm font-semibold text-foreground">{totalInteractions}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2.5">
          <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Última consulta</p>
            <p className="text-sm font-semibold text-foreground">
              {contact.converted_at
                ? new Date(contact.converted_at).toLocaleDateString('pt-BR')
                : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2.5">
          <Heart className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Paciente</p>
            <p className="text-sm font-semibold text-foreground">
              {contact.is_patient ? 'Sim' : 'Não'}
            </p>
          </div>
        </div>
      </div>
      {contact.ai_suggested_action && (
        <div className="flex items-start gap-2 bg-primary/5 text-primary rounded-lg px-3 py-2.5">
          <Activity className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Ação sugerida pela IA</p>
            <p className="text-sm text-foreground mt-0.5">{contact.ai_suggested_action}</p>
          </div>
        </div>
      )}
    </div>
  )
}
