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
  Calendar,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { runBaselineRollback, runCareStateRetroativo } from '@/services/care_retroativo_service'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  getAutomationsAudit,
  getCareAlertSettings,
  setPlantaoFimDeSemana,
  type AutomationAuditItem,
} from '@/services/care_alerts_service'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { toast } from 'sonner'

interface AutomationsControlCardProps {
  className?: string
  showAuditButton?: boolean
  compact?: boolean
}

export function AutomationsControlCard({
  className = '',
  showAuditButton = true,
  compact = false,
}: AutomationsControlCardProps) {
  const { accountId } = useCurrentAccount()
  const { paused, pausedAt, pausedBy, loading, toggling, toggle } = useAutomationsStatus()
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditItems, setAuditItems] = useState<AutomationAuditItem[]>([])

  // Estado do Modo Plantão (fim de semana)
  const [plantaoFimDeSemana, setPlantaoFimDeSemanaState] = useState<boolean>(false)
  const [salvandoPlantao, setSalvandoPlantao] = useState<boolean>(false)

  // Estado de Rollback e Reconciliação Retroativa
  const [rollingBack, setRollingBack] = useState<boolean>(false)
  const [runningRetroativo, setRunningRetroativo] = useState<boolean>(false)

  React.useEffect(() => {
    let cancel = false
    async function carregarPlantao() {
      if (!accountId) return
      try {
        const settings = await getCareAlertSettings(accountId)
        if (!cancel && settings) {
          setPlantaoFimDeSemanaState(Boolean(settings.plantao_fim_de_semana))
        }
      } catch (err) {
        console.warn('[AutomationsControlCard] Erro ao carregar plantao_fim_de_semana:', err)
      }
    }
    carregarPlantao()
    return () => {
      cancel = true
    }
  }, [accountId])

  const handleTogglePlantao = async (novoValor: boolean) => {
    if (!accountId || salvandoPlantao) return
    setSalvandoPlantao(true)
    try {
      await setPlantaoFimDeSemana(accountId, novoValor)
      setPlantaoFimDeSemanaState(novoValor)
      toast.success(
        novoValor
          ? 'Modo Plantão ativado: IA ativa sáb/dom para dúvidas básicas'
          : 'Modo Plantão desativado',
      )
    } catch (err: any) {
      console.error('[AutomationsControlCard] Erro ao atualizar Modo Plantão:', err)
      toast.error('Erro ao atualizar Modo Plantão')
    } finally {
      setSalvandoPlantao(false)
    }
  }

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

  const handleRollback = async () => {
    if (rollingBack) return
    const confirmAction = window.confirm(
      'Deseja desfazer a reconciliação e restaurar os estados anteriores registrados no snapshot "plataforma-limpa"?',
    )
    if (!confirmAction) return

    setRollingBack(true)
    try {
      const res = await runBaselineRollback('plataforma-limpa')
      toast.success(`Desfazer concluído: ${res.restored_count} registros restaurados com sucesso.`)
    } catch (err: any) {
      console.error('[AutomationsControlCard] Erro no rollback:', err)
      toast.error('Erro ao executar Desfazer: ' + (err?.message || 'Falha de comunicação'))
    } finally {
      setRollingBack(false)
    }
  }

  const handleRunRetroativo = async () => {
    if (runningRetroativo) return
    setRunningRetroativo(true)
    try {
      const res = await runCareStateRetroativo()
      toast.success(
        `Plataforma limpa: ${res.total_contacts_processed} contatos reconciliados, ${res.resolved_obsolete_tasks_count} tarefas resolvidas.`,
      )
    } catch (err: any) {
      console.error('[AutomationsControlCard] Erro na reconciliação retroativa:', err)
      toast.error('Erro na reconciliação: ' + (err?.message || 'Falha'))
    } finally {
      setRunningRetroativo(false)
    }
  }

  return (
    <>
      <Card
        className={`border-border/50 bg-white/60 backdrop-blur-xs shadow-2xs rounded-2xl overflow-hidden transition-all ${
          compact ? 'p-3 sm:p-3.5' : ''
        } ${className}`}
      >
        {compact ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  paused ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="font-semibold text-foreground text-xs">
                  {paused ? 'Automações pausadas' : 'Automações ativas'}
                </span>
                <span className="text-muted-foreground text-[11px] truncate">
                  {paused
                    ? 'Disparos sob controle manual — clique para revisar ou retomar'
                    : 'Lembretes e réguas operando com Blindagem Noturna (21h–07h)'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-auto shrink-0 flex-wrap">
              {/* Interruptor Modo Plantão (fim de semana) */}
              <div className="flex items-center space-x-1.5 border-r border-border/50 pr-3 mr-1">
                <Switch
                  id="plantao-switch-home-compact"
                  checked={plantaoFimDeSemana}
                  disabled={salvandoPlantao}
                  onCheckedChange={handleTogglePlantao}
                  className="scale-75"
                />
                <Label
                  htmlFor="plantao-switch-home-compact"
                  className="text-[11px] font-medium cursor-pointer select-none text-foreground/80"
                >
                  Modo Plantão:{' '}
                  {plantaoFimDeSemana ? 'IA ativa sáb/dom para dúvidas básicas' : 'Desligado'}
                </Label>
              </div>

              {showAuditButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openAudit}
                  className="h-7 text-[11px] px-2 text-muted-foreground hover:text-foreground gap-1"
                >
                  <History className="w-3 h-3" />
                  Auditoria
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleRollback}
                disabled={rollingBack || runningRetroativo}
                className="h-7 text-[11px] px-2 rounded-lg border-amber-300 text-amber-800 hover:bg-amber-50 gap-1 font-medium"
                title="Desfazer snapshot plataforma-limpa"
              >
                {rollingBack ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3 text-amber-700" />
                )}
                <span>Desfazer</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => toggle()}
                disabled={loading || toggling}
                className={`h-7 text-xs px-2.5 rounded-lg font-medium transition-all ${
                  paused
                    ? 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {toggling ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    ...
                  </span>
                ) : paused ? (
                  <span className="inline-flex items-center gap-1">
                    <Play className="w-3 h-3 fill-current text-emerald-600" />
                    Revisar / Ativar
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Pause className="w-3 h-3 fill-current text-muted-foreground" />
                    Pausar envios
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
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
                      Controle global dos envios de lembretes, confirmações, recall e respostas da
                      IA.
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

                <div className="flex items-center gap-3">
                  <div className="flex items-center space-x-1.5">
                    <Switch
                      id="plantao-switch-home-full"
                      checked={plantaoFimDeSemana}
                      disabled={salvandoPlantao}
                      onCheckedChange={handleTogglePlantao}
                      className="scale-90"
                    />
                    <Label
                      htmlFor="plantao-switch-home-full"
                      className="text-xs font-semibold cursor-pointer select-none text-foreground"
                    >
                      Modo Plantão (fim de semana):{' '}
                      <span
                        className={
                          plantaoFimDeSemana ? 'text-emerald-700' : 'text-muted-foreground'
                        }
                      >
                        {plantaoFimDeSemana ? 'IA ativa sáb/dom para dúvidas básicas' : 'Desligado'}
                      </span>
                    </Label>
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

                  <div className="flex items-center gap-1.5 border-l border-border/50 pl-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRollback}
                      disabled={rollingBack || runningRetroativo}
                      className="h-7 text-xs px-2.5 rounded-lg border-amber-300 text-amber-800 hover:bg-amber-50 gap-1 font-medium"
                      title="Restaurar estado gravado no snapshot plataforma-limpa"
                    >
                      {rollingBack ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3 text-amber-700" />
                      )}
                      <span>Desfazer (Snapshot)</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRunRetroativo}
                      disabled={runningRetroativo || rollingBack}
                      className="h-7 text-xs px-2.5 rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50 gap-1 font-medium"
                      title="Rodar Reconciliação Retroativa Determinística"
                    >
                      {runningRetroativo ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-indigo-600" />
                      )}
                      <span>Limpar Plataforma</span>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </>
        )}
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
                        {item.patient_name ||
                          (typeof item.remote_jid === 'string' && item.remote_jid.includes('@')
                            ? item.remote_jid.split('@')[0]
                            : item.remote_jid || 'Paciente')}
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
