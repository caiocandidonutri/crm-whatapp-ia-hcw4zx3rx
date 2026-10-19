import React, { useState } from 'react'
import { CheckCircle2, UserX, DollarSign, Calendar, MapPin, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import type { Appointment, PaymentMethod } from '@/types/models'
import { updateAppointment } from '@/services/appointments'
import { createPayment } from '@/services/payments_service'
import { formatBrazilianDate, formatTimeSaoPaulo } from '@/lib/datetime'

interface AppointmentClosingDialogProps {
  appointment: Appointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  initialOutcome?: 'realizado' | 'faltou'
}

export function AppointmentClosingDialog({
  appointment,
  open,
  onOpenChange,
  onSuccess,
  initialOutcome,
}: AppointmentClosingDialogProps) {
  const [outcome, setOutcome] = useState<'realizado' | 'faltou'>(initialOutcome || 'realizado')

  React.useEffect(() => {
    if (initialOutcome) {
      setOutcome(initialOutcome)
    }
  }, [initialOutcome, open])
  const [valor, setValor] = useState<string>('500')
  const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>('pix')
  const [dataPagamento, setDataPagamento] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [observacoes, setObservacoes] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!appointment) return null

  const handleConfirm = async () => {
    if (!appointment.id) return
    setIsSubmitting(true)
    try {
      // 1. Atualizar agendamento (realizado ou faltou)
      const currentNotes = appointment.notes || ''
      const closingNote =
        outcome === 'realizado'
          ? `[Fechamento] Consulta realizada com sucesso em ${dataPagamento}.`
          : `[Fechamento] Paciente faltou à consulta (no-show) em ${dataPagamento}.`

      const updatedNotes = currentNotes ? `${currentNotes}\n${closingNote}` : closingNote

      await updateAppointment(appointment.id, {
        status: outcome,
        notes: updatedNotes,
      })

      // 2. Se realizado, registrar pagamento na coleção leve payments
      const valorNum = parseFloat(valor.replace(',', '.')) || 0
      if (outcome === 'realizado' && valorNum > 0) {
        await createPayment({
          account_id: appointment.account_id,
          appointment_id: appointment.id,
          crm_contact_id: appointment.patient_id,
          valor: valorNum,
          forma_pagamento: formaPagamento,
          data_pagamento: new Date(dataPagamento).toISOString(),
          unidade: appointment.city,
          observacoes: observacoes || undefined,
        })
      }

      toast.success(
        outcome === 'realizado'
          ? `Consulta de ${appointment.patient_name} concluída e pagamento registrado!`
          : `Falta de ${appointment.patient_name} registrada com sucesso.`,
      )

      onOpenChange(false)
      if (onSuccess) onSuccess()
    } catch (err: any) {
      console.error('[AppointmentClosingDialog] Erro:', err)
      toast.error('Erro ao fechar consulta. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="font-serif text-lg font-bold text-primary">
                Fechamento do Ciclo da Consulta
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Registre o desfecho do atendimento e fluxo financeiro no CRM.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo do Agendamento */}
        <div className="p-3 rounded-xl bg-slate-50 border border-border/60 text-xs space-y-1.5">
          <div className="flex items-center justify-between font-semibold text-foreground">
            <span className="truncate">{appointment.patient_name}</span>
            <Badge variant="outline" className="text-[10px] bg-white">
              {appointment.appointment_type || 'Consulta'}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground text-[11px] flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {appointment.starts_at ? formatBrazilianDate(appointment.starts_at) : '—'} às{' '}
              {appointment.starts_at ? formatTimeSaoPaulo(appointment.starts_at) : ''}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {appointment.city}
            </span>
          </div>
        </div>

        {/* Escolha do Desfecho */}
        <div className="space-y-2 pt-1">
          <Label className="text-xs font-semibold text-foreground">Desfecho da Consulta</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOutcome('realizado')}
              className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                outcome === 'realizado'
                  ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20 text-emerald-950'
                  : 'border-border/60 hover:bg-slate-50 text-foreground'
              }`}
            >
              <CheckCircle2
                className={`w-4 h-4 ${outcome === 'realizado' ? 'text-emerald-600' : 'text-muted-foreground'}`}
              />
              <div>
                <p className="text-xs font-semibold">Realizada</p>
                <p className="text-[10px] text-muted-foreground">Paciente compareceu</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setOutcome('faltou')}
              className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                outcome === 'faltou'
                  ? 'border-rose-500 bg-rose-50/50 ring-2 ring-rose-500/20 text-rose-950'
                  : 'border-border/60 hover:bg-slate-50 text-foreground'
              }`}
            >
              <UserX
                className={`w-4 h-4 ${outcome === 'faltou' ? 'text-rose-600' : 'text-muted-foreground'}`}
              />
              <div>
                <p className="text-xs font-semibold">Faltou (No-show)</p>
                <p className="text-[10px] text-muted-foreground">Não compareceu</p>
              </div>
            </button>
          </div>
        </div>

        {/* Se Realizado: Dados Financeiros */}
        {outcome === 'realizado' && (
          <div className="space-y-3 pt-2 border-t border-border/40 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="close-valor"
                  className="text-xs font-semibold flex items-center gap-1"
                >
                  <DollarSign className="w-3 h-3 text-emerald-600" />
                  Valor Cobrado (R$)
                </Label>
                <Input
                  id="close-valor"
                  type="text"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="500,00"
                  className="h-9 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">Padrão da clínica: R$ 500,00</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="close-data" className="text-xs font-semibold">
                  Data do Pagamento
                </Label>
                <Input
                  id="close-data"
                  type="date"
                  value={dataPagamento}
                  onChange={(e) => setDataPagamento(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Forma de Pagamento</Label>
              <RadioGroup
                value={formaPagamento}
                onValueChange={(v) => setFormaPagamento(v as PaymentMethod)}
                className="grid grid-cols-2 gap-2 text-xs"
              >
                <div className="flex items-center space-x-2 border border-border/60 rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="pix" id="forma-pix" />
                  <Label htmlFor="forma-pix" className="text-xs font-medium cursor-pointer">
                    Pix
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="cartao" id="forma-cartao" />
                  <Label htmlFor="forma-cartao" className="text-xs font-medium cursor-pointer">
                    Cartão
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="dinheiro" id="forma-dinheiro" />
                  <Label htmlFor="forma-dinheiro" className="text-xs font-medium cursor-pointer">
                    Dinheiro
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                  <RadioGroupItem value="transferencia" id="forma-transf" />
                  <Label htmlFor="forma-transf" className="text-xs font-medium cursor-pointer">
                    Transferência
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-1">
              <Label htmlFor="close-obs" className="text-xs font-medium text-muted-foreground">
                Observações financeiras (opcional)
              </Label>
              <Input
                id="close-obs"
                type="text"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex: Pago na recepção, 2x no cartão, etc."
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="text-xs h-9"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`text-xs h-9 ${outcome === 'realizado' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
          >
            {isSubmitting
              ? 'Salvando...'
              : outcome === 'realizado'
                ? 'Confirmar Realizada & Registrar Pagamento'
                : 'Confirmar Falta (No-show)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
