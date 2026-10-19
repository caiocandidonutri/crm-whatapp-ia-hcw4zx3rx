import React, { useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { safePbFullList } from '@/lib/pocketbase/resilient'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cleanPhoneDigits } from '@/lib/phone'
import { Users, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react'

interface CrmClubBatchModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

interface BatchSummary {
  updatedCount: number
  notFoundList: string[]
  totalLines: number
}

export function CrmClubBatchModal({ open, onClose, onSuccess }: CrmClubBatchModalProps) {
  const [phoneText, setPhoneText] = useState('')
  const [planExpiresAt, setPlanExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<BatchSummary | null>(null)

  const handleReset = () => {
    setPhoneText('')
    setPlanExpiresAt('')
    setSummary(null)
  }

  const handleClose = () => {
    if (loading) return
    handleReset()
    onClose()
  }

  const handleProcessBatch = async () => {
    const rawLines = phoneText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    if (rawLines.length === 0) {
      toast.error('Cole ao menos um telefone para processar.')
      return
    }

    setLoading(true)
    setSummary(null)

    let updatedCount = 0
    const notFoundList: string[] = []

    try {
      // Buscar contatos com safePbFullList resiliente (perPage: 200, retry 429 e timeout)
      const allContacts = await safePbFullList<{
        id: string
        phone?: string
        jid?: string
        contact_name?: string
        push_name?: string
      }>({
        collection: 'crm_contacts',
        perPage: 200,
        fields: 'id,phone,jid,contact_name,push_name',
        label: 'CrmClubBatchModal:contacts',
      })

      // Criar mapa de dígitos limpos para contatos
      // Um contato pode bater com: dígitos completos, com DDI 55, sem DDI 55, ou sufixo
      const phoneToContactMap = new Map<string, any>()
      for (const c of allContacts) {
        const rawDigits = cleanPhoneDigits(c.phone || c.jid)
        if (!rawDigits) continue

        phoneToContactMap.set(rawDigits, c)
        // Se começar com 55 e tiver 12 ou 13 dígitos, indexa também a versão sem 55
        if (rawDigits.startsWith('55') && (rawDigits.length === 12 || rawDigits.length === 13)) {
          phoneToContactMap.set(rawDigits.slice(2), c)
        }
        // Se tiver 10 ou 11 dígitos (sem 55), indexa também a versão com 55
        if (rawDigits.length === 10 || rawDigits.length === 11) {
          phoneToContactMap.set('55' + rawDigits, c)
        }
        // Indexa também os últimos 8 dígitos (número sem DDD)
        if (rawDigits.length >= 8) {
          phoneToContactMap.set(rawDigits.slice(-8), c)
        }
      }

      const expiresIso = planExpiresAt ? new Date(planExpiresAt).toISOString() : null

      const updatedIds = new Set<string>()

      for (const line of rawLines) {
        const digits = cleanPhoneDigits(line)
        if (!digits) {
          notFoundList.push(line)
          continue
        }

        // Tenta achar com dígitos exatos, sem 55, com 55 ou pelos últimos 8 dígitos
        let targetContact = phoneToContactMap.get(digits)
        if (!targetContact && digits.startsWith('55') && digits.length >= 12) {
          targetContact = phoneToContactMap.get(digits.slice(2))
        }
        if (!targetContact && (digits.length === 10 || digits.length === 11)) {
          targetContact = phoneToContactMap.get('55' + digits)
        }
        if (!targetContact && digits.length >= 8) {
          targetContact = phoneToContactMap.get(digits.slice(-8))
        }

        if (targetContact && !updatedIds.has(targetContact.id)) {
          try {
            const updatePayload: Record<string, any> = {
              is_club_member: true,
            }
            if (expiresIso) {
              updatePayload.plan_expires_at = expiresIso
            }

            await pb.collection('crm_contacts').update(targetContact.id, updatePayload, {
              requestKey: null,
            })
            updatedIds.add(targetContact.id)
            updatedCount++
          } catch (updateErr) {
            console.error('Erro ao atualizar contato no lote:', updateErr)
            notFoundList.push(line)
          }
        } else if (!targetContact) {
          notFoundList.push(line)
        }
      }

      setSummary({
        updatedCount,
        notFoundList,
        totalLines: rawLines.length,
      })

      if (updatedCount > 0) {
        toast.success(`${updatedCount} contato(s) marcado(s) como Membro do Clube!`)
        onSuccess?.()
      } else {
        toast.warning('Nenhum contato foi encontrado na base para os telefones informados.')
      }
    } catch (err: any) {
      console.error('Erro no lote do clube:', err)
      toast.error('Erro ao processar lote: ' + (err?.message || 'tente novamente'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-purple-900">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Cadastro em Lote do Clube
          </DialogTitle>
          <DialogDescription>
            Cole uma lista de telefones de pacientes para marcar como{' '}
            <strong>Membro do Clube</strong> em massa e definir a validade do plano para as réguas
            de recall.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="batch-phones" className="text-xs font-semibold">
              Telefones dos Membros (um por linha)
            </Label>
            <Textarea
              id="batch-phones"
              placeholder={'35992880270\n(35) 99123-4567\n+55 35 98888-1122\n35987654321'}
              rows={6}
              value={phoneText}
              onChange={(e) => setPhoneText(e.target.value)}
              disabled={loading}
              className="font-mono text-xs leading-relaxed resize-y bg-muted/20"
            />
            <p className="text-[11px] text-muted-foreground">
              Formatos aceitos: com ou sem DDD, com ou sem DDI +55, com traço, espaço ou parênteses.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="batch-expires" className="text-xs font-semibold">
              Data de Vencimento do Plano (Opcional)
            </Label>
            <Input
              id="batch-expires"
              type="date"
              value={planExpiresAt}
              onChange={(e) => setPlanExpiresAt(e.target.value)}
              disabled={loading}
              className="text-xs bg-muted/20"
            />
            <p className="text-[11px] text-muted-foreground">
              Preenche <code className="text-purple-700">plan_expires_at</code> nos contatos
              atualizados para acionar a régua de 15 dias antes do vencimento.
            </p>
          </div>

          {summary && (
            <div className="p-3.5 rounded-xl border border-border bg-muted/30 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Resultado do Processamento
                </span>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="bg-emerald-50 text-emerald-800 border-emerald-300"
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    {summary.updatedCount} atualizados
                  </Badge>
                  {summary.notFoundList.length > 0 && (
                    <Badge variant="outline" className="bg-rose-50 text-rose-800 border-rose-300">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {summary.notFoundList.length} não encontrados
                    </Badge>
                  )}
                </div>
              </div>

              {summary.notFoundList.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-border/50">
                  <span className="text-[11px] font-medium text-rose-700">
                    Telefones não localizados na base de contatos:
                  </span>
                  <div className="max-h-28 overflow-y-auto rounded-md bg-white p-2 border border-rose-200 font-mono text-[11px] text-muted-foreground space-y-0.5">
                    {summary.notFoundList.map((ph, idx) => (
                      <div key={idx} className="truncate">
                        • {ph}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" onClick={handleClose} disabled={loading} className="rounded-xl">
            {summary ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button
            onClick={handleProcessBatch}
            disabled={loading || !phoneText.trim()}
            className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Users className="w-4 h-4 mr-2" />
                Atualizar Membros do Clube
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
