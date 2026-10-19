import React from 'react'
import { Sparkles, CheckCircle2, UserX, Clock, MapPin } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Appointment } from '@/types/models'
import { formatTimeSaoPaulo } from '@/lib/datetime'

interface YesterdayClosureBannerProps {
  unclosedAppointments: Appointment[]
  onOpenClosingDialog: (appointment: Appointment, defaultOutcome?: 'realizado' | 'faltou') => void
  onDismiss?: () => void
}

export function YesterdayClosureBanner({
  unclosedAppointments,
  onOpenClosingDialog,
}: YesterdayClosureBannerProps) {
  if (!unclosedAppointments || unclosedAppointments.length === 0) {
    return null
  }

  return (
    <Card className="p-4 border-amber-200 bg-gradient-to-r from-amber-50/70 via-orange-50/40 to-card shadow-sm space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-700">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Sugestão Inteligente: Fechamento das consultas de ontem
              </h3>
              <Badge
                variant="outline"
                className="text-[10px] bg-amber-100/60 text-amber-800 border-amber-300"
              >
                {unclosedAppointments.length} pendente(s)
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              A IA identificou consultas agendadas ontem sem desfecho registrado. Confirme com 1
              clique para atualizar o histórico e métricas financeiras.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
        {unclosedAppointments.map((app) => (
          <div
            key={app.id}
            className="p-2.5 rounded-xl bg-white border border-amber-200/80 shadow-xs flex flex-col justify-between gap-2 text-xs"
          >
            <div>
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="truncate">{app.patient_name || 'Paciente'}</span>
                <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-600" />
                  {app.starts_at ? formatTimeSaoPaulo(app.starts_at) : '—'}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {app.city || 'Carmo do Rio Claro'}
                </span>
                <span>•</span>
                <span>{app.appointment_type || 'Consulta'}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenClosingDialog(app, 'realizado')}
                className="flex-1 h-7 text-[11px] gap-1 border-emerald-300 bg-emerald-50/50 hover:bg-emerald-100/60 text-emerald-800"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Realizada
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenClosingDialog(app, 'faltou')}
                className="flex-1 h-7 text-[11px] gap-1 border-rose-300 bg-rose-50/50 hover:bg-rose-100/60 text-rose-800"
              >
                <UserX className="w-3 h-3 text-rose-600" />
                Faltou
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
