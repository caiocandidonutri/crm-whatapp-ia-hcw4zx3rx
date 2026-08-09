import { useState, useEffect } from 'react'
import { Heart, MessageCircle, Calendar, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import pb from '@/lib/pocketbase/client'
import { CrmContact } from '@/types/models'

interface PatientCareInfoProps {
  contact: CrmContact
}

export function PatientCareInfo({ contact }: PatientCareInfoProps) {
  const [totalInteractions, setTotalInteractions] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!contact?.jid || !contact?.instance_name) return
    let cancelled = false
    pb.collection('whatsapp_messages')
      .getList(1, 1, {
        filter: `remote_jid = '${contact.jid}' && instance_name = '${contact.instance_name}'`,
        requestKey: null,
      })
      .then((res) => {
        if (!cancelled) setTotalInteractions(res.totalItems)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contact?.jid, contact?.instance_name])

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

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Cuidado do Paciente
      </h3>
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
