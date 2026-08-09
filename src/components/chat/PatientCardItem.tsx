import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PatientCard } from '@/services/crm_care_service'

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

interface PatientCardItemProps {
  patient: PatientCard
  onClick: () => void
  onOpenWhatsapp: () => void
}

export function PatientCardItem({ patient, onClick, onOpenWhatsapp }: PatientCardItemProps) {
  const badge = priorityBadge(patient.ai_priority)
  const stageLabel = STAGE_LABELS[patient.stage] || patient.stage || '—'

  return (
    <div
      className="group rounded-xl border border-border/40 bg-white p-3 transition-all hover:shadow-md hover:border-primary/30 cursor-pointer"
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
