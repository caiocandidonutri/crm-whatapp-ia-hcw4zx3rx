import { useState } from 'react'
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Users,
  Heart,
  Tag,
  Zap,
  TrendingUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { generateCrmReport, type ReportData } from '@/services/crm_reports_service'
import { CrmStage } from '@/services/crm_stages_service'
import { stageStyle } from '@/lib/stage-colors'
import { toast } from 'sonner'

const PRIORITY_META: Record<string, { label: string; badge: string; bar: string }> = {
  urgente: { label: 'Urgente', badge: 'bg-red-100 text-red-700', bar: 'bg-red-500' },
  alta: { label: 'Alta', badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  media: { label: 'Média', badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
  baixa: { label: 'Baixa', badge: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500' },
  sem_prioridade: {
    label: 'Sem prioridade',
    badge: 'bg-slate-100 text-slate-600',
    bar: 'bg-slate-400',
  },
}

function priorityKey(p: number) {
  if (p >= 8) return 'urgente'
  if (p >= 6) return 'alta'
  if (p >= 4) return 'media'
  if (p >= 1) return 'baixa'
  return 'sem_prioridade'
}

interface CrmAiReportProps {
  stages: CrmStage[]
}

export function CrmAiReport({ stages }: CrmAiReportProps) {
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const generate = async () => {
    setLoading(true)
    setError(false)
    try {
      setReport(await generateCrmReport())
      toast.success('Relatório gerado com sucesso')
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const stageLabel = (k: string) => stages.find((s) => s.key === k)?.label || k
  const stageColor = (k: string) => stageStyle(stages.find((s) => s.key === k)?.color).dot
  const maxVal = (obj: Record<string, number>) => Math.max(...Object.values(obj), 1)

  if (loading)
    return (
      <Card className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl">
        <CardContent className="p-8 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Gerando relatório com IA...</p>
          <p className="text-xs text-muted-foreground/70">
            Analisando contatos, conversas e mensagens
          </p>
        </CardContent>
      </Card>
    )

  if (error)
    return (
      <Alert className="border-amber-200 bg-amber-50 animate-fade-in">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <AlertTitle className="text-amber-900 text-sm font-semibold">
              Não foi possível gerar o relatório
            </AlertTitle>
            <AlertDescription className="text-amber-700 text-xs mt-0.5">
              Verifique sua conexão ou tente novamente em instantes.
            </AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={generate}
              className="mt-2.5 h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
            >
              <RefreshCw className="w-3 h-3 mr-1.5" />
              Tentar novamente
            </Button>
          </div>
        </div>
      </Alert>
    )

  if (!report)
    return (
      <Card className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl">
        <CardContent className="p-8 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary/40" />
          </div>
          <h3 className="font-serif text-xl font-bold text-primary">Relatórios de IA</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Gere um relatório inteligente com insights sobre seus contatos, distribuição por etapa,
            prioridade e ações recomendadas.
          </p>
          <Button onClick={generate}>
            <Sparkles className="w-4 h-4 mr-2" />
            Gerar relatório
          </Button>
        </CardContent>
      </Card>
    )

  const { profileOverview: po, nextActions: actions } = report

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold text-primary">Relatórios de IA</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={generate}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="font-serif font-bold text-primary">Insights da IA</h3>
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {po.aiInsights}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Total',
            value: po.totalContacts,
            icon: Users,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
          },
          {
            label: 'Pacientes',
            value: po.patientClassification.patients,
            icon: Heart,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
          },
          {
            label: 'Não pacientes',
            value: po.patientClassification.nonPatients,
            icon: Users,
            color: 'text-slate-600',
            bg: 'bg-slate-50',
          },
          {
            label: 'Categorias',
            value: po.categoryGroups.length,
            icon: Tag,
            color: 'text-violet-600',
            bg: 'bg-violet-50',
          },
        ].map((s) => (
          <Card key={s.label} className="rounded-xl border-border/40">
            <CardContent className="p-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', s.bg)}>
                  <s.icon className={cn('w-3.5 h-3.5', s.color)} />
                </div>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              <span className="text-2xl font-serif font-bold text-primary">{s.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/40">
          <CardContent className="p-5">
            <h3 className="font-serif font-bold text-primary mb-4">Distribuição por etapa</h3>
            <div className="flex flex-col gap-2">
              {Object.entries(po.stageDistribution).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-sm w-32 truncate">{stageLabel(k)}</span>
                  <div className="flex-1 h-6 bg-muted/50 rounded-md overflow-hidden">
                    <div
                      className={cn('h-full rounded-md transition-all duration-500', stageColor(k))}
                      style={{ width: `${(v / maxVal(po.stageDistribution)) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold w-8 text-right">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/40">
          <CardContent className="p-5">
            <h3 className="font-serif font-bold text-primary mb-4">Distribuição por prioridade</h3>
            <div className="flex flex-col gap-2">
              {Object.entries(po.priorityDistribution).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-sm w-32 truncate">{PRIORITY_META[k]?.label || k}</span>
                  <div className="flex-1 h-6 bg-muted/50 rounded-md overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-md transition-all duration-500',
                        PRIORITY_META[k]?.bar || 'bg-slate-400',
                      )}
                      style={{ width: `${(v / maxVal(po.priorityDistribution)) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold w-8 text-right">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {po.categoryGroups.length > 0 && (
        <Card className="rounded-2xl border-border/40">
          <CardContent className="p-5">
            <h3 className="font-serif font-bold text-primary mb-3">Agrupamento por categoria</h3>
            <div className="flex flex-wrap gap-2">
              {po.categoryGroups.map((c) => (
                <Badge key={c.id} variant="secondary" className="bg-primary/10 text-primary">
                  {c.name} <span className="ml-1 font-bold">{c.count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {actions.length > 0 && (
        <Card className="rounded-2xl border-border/40">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-primary" />
              <h3 className="font-serif font-bold text-primary">Ações recomendadas</h3>
            </div>
            <div className="flex flex-col gap-2">
              {actions.map((a, i) => (
                <div
                  key={a.contactId}
                  className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{a.contactName}</span>
                      {a.isPatient && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-0"
                        >
                          Paciente
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{a.action}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] border-0',
                        PRIORITY_META[priorityKey(a.priority)]?.badge,
                      )}
                    >
                      P{a.priority}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] border-0 bg-slate-100 text-slate-600"
                    >
                      {stageLabel(a.stage)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
