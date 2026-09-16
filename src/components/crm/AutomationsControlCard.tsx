import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAutomationsStatus } from '@/hooks/use-automations-status'
import {
  Play,
  Pause,
  Loader2,
  Radio,
  Clock,
  History,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { getAutomationsAudit, type AutomationAuditItem } from '@/services/care_alerts_service'

interface AutomationsControlCardProps {
  className?: string
  showAuditButton?: boolean
}

export function AutomationsControlCard({
  className = '',
  showAuditButton = true,
}: AutomationsControlCardProps) {
  const { paused, pausedAt, pausedBy, loading, toggling, toggle } = useAutomationsStatus()
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditItems, setAuditItems] = useState<AutomationAuditItem[]>([])

  const openAudit = async () => {
    setAuditOpen(true)
    setAuditLoading(true)
    try {
      const res = await getAutomationsAudit(35)
      setAuditItems(res.items || [])
    } catch (err) {
      console.error('Erro ao buscar auditoria de automações:', err)
    } finally {
      setAuditLoading(false)
    }
  }

  const formatAuditType = (type: string) => {
    switch (type) {
      case 'confirmacao_24h':
        return 'Confirmação 24h'
      case 'lembrete_consulta':
        return 'Lembrete do dia'
      case 'recall_paciente':
        return 'Recall / Inativo'
      case 'pesquisa_satisfacao':
        return 'Pesquisa NPS'
      case 'fora_de_horario':
        return 'Fora de horário'
      case 'ia_automatica':
        return 'Resposta IA'
      default:
        return 'Mensagem'
    }
  }

  return (
    <>
      <Card
        className={`border-border/60 bg-white/70 backdrop-blur-sm shadow-sm rounded-2xl overflow-hidden transition-all ${className}`}
      >
        <CardHeader className="p-4 sm:p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl transition-colors ${
                  paused
                    ? 'bg-rose-50 text-rose-600 border border-rose-100'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                }`}
              >
                <Radio className={`w-5 h-5 ${!paused ? 'animate-pulse' : ''}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base sm:text-lg font-bold text-foreground">
                    Mensagens automáticas
                  </CardTitle>
                  {loading ? (
                    <Badge variant="outline" className="text-xs">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Carregando
                    </Badge>
                  ) : paused ? (
                    <Badge className="bg-rose-100 hover:bg-rose-100 text-rose-700 border-rose-200 text-xs font-semibold">
                      Pausadas
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-700 border-emerald-200 text-xs font-semibold">
                      Ativas
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs sm:text-sm mt-0.5">
                  Controle global dos envios de lembretes, confirmações, recall e respostas da IA.
                </CardDescription>
              </div>
            </div>

            <Button
              size="sm"
              variant={paused ? 'default' : 'outline'}
              onClick={() => toggle()}
              disabled={loading || toggling}
              className={`shrink-0 font-medium h-9 px-4 rounded-xl shadow-sm transition-all ${
                paused
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-none'
                  : 'border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800'
              }`}
            >
              {toggling ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {paused ? 'Ativando...' : 'Pausando...'}
                </span>
              ) : paused ? (
                <span className="inline-flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Ativar envios
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  Pausar envios
                </span>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-4 sm:px-5 pb-4 pt-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {paused ? (
                <span>
                  Pausado
                  {pausedAt
                    ? ` em ${new Date(pausedAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
                  {pausedBy ? ` por ${pausedBy}` : ''}. Nenhum disparo aos pacientes.
                </span>
              ) : (
                <span className="text-emerald-700 font-medium">
                  Sistema operando normalmente. Blindagem noturna ativa das 21h às 07h.
                </span>
              )}
            </div>

            {showAuditButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={openAudit}
                className="h-7 text-xs px-2 text-muted-foreground hover:text-primary self-start sm:self-auto gap-1"
              >
                <History className="w-3.5 h-3.5" />
                Ver auditoria de envios
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Modal de Auditoria de Envios */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <History className="w-5 h-5 text-primary" />
              Auditoria de Mensagens Automáticas
            </DialogTitle>
            <DialogDescription className="text-xs">
              Histórico recente dos últimos disparos enviados aos pacientes com data e horário de
              Brasília.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 space-y-2 py-2">
            {auditLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span>Carregando auditoria...</span>
              </div>
            ) : auditItems.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                Nenhum envio registrado recentemente.
              </div>
            ) : (
              auditItems.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-border/70 bg-muted/20 hover:bg-muted/30 transition-colors text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground text-sm">
                        {item.patient_name || item.remote_jid.split('@')[0]}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-normal py-0">
                        {formatAuditType(item.automation_type)}
                      </Badge>
                      {item.is_automated && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-blue-50 text-blue-700 py-0"
                        >
                          Automático
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {item.created_at_sp || item.created_at}
                    </span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 leading-relaxed bg-white/60 p-2 rounded-lg border border-border/40 font-mono text-[11px]">
                    {item.content || '(sem conteúdo textual)'}
                  </p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
