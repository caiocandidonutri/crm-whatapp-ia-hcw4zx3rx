import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { fetchFollowupReport, FollowupReportResponse } from '@/services/crm_followup_report_service'
import {
  UserCheck,
  TrendingUp,
  RefreshCw,
  Clock,
  Sparkles,
  ChevronRight,
  MessageCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'

interface Props {
  className?: string
}

export function FollowupRecoveryReport({ className }: Props) {
  const [days, setDays] = useState<7 | 30>(30)
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<FollowupReportResponse | null>(null)
  const navigate = useNavigate()

  const loadData = async (selectedDays: 7 | 30) => {
    setLoading(true)
    try {
      const data = await fetchFollowupReport(selectedDays)
      setReport(data)
    } catch (err) {
      // Fallback gracioso com valores zerados
      setReport({
        days: selectedDays,
        summary: { total_recovered: 0, total_pending: 0, recovery_rate: 0 },
        rules: [
          {
            id: 'r1',
            name: 'Consulta inicial',
            followup_days: 7,
            displayName: 'Consulta inicial (7d)',
            created_pending: 0,
            recovered_count: 0,
            recovery_rate: 0,
          },
          {
            id: 'r2',
            name: 'Retorno SOP',
            followup_days: 15,
            displayName: 'Retorno SOP (15d)',
            created_pending: 0,
            recovered_count: 0,
            recovery_rate: 0,
          },
          {
            id: 'r3',
            name: 'Procedimento hormonal',
            followup_days: 5,
            displayName: 'Procedimento hormonal (5d)',
            created_pending: 0,
            recovered_count: 0,
            recovery_rate: 0,
          },
        ],
        recent_recovered: [],
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(days)
  }, [days])

  return (
    <Card className={`border shadow-sm overflow-hidden bg-card ${className || ''}`}>
      <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                <UserCheck className="w-4 h-4" />
              </div>
              <CardTitle className="text-base sm:text-lg font-semibold tracking-tight">
                Pacientes Recuperados por Follow-up
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Métricas de conversão e reativação baseadas nas regras ativas da clínica
            </CardDescription>
          </div>

          <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg self-start sm:self-auto border">
            <Button
              variant={days === 7 ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDays(7)}
              className="h-8 px-3 text-xs font-medium min-h-[36px] sm:min-h-0"
            >
              7 dias
            </Button>
            <Button
              variant={days === 30 ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDays(30)}
              className="h-8 px-3 text-xs font-medium min-h-[36px] sm:min-h-0"
            >
              30 dias
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => loadData(days)}
              title="Atualizar"
              disabled={loading}
              className="h-8 w-8 min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 space-y-6">
        {/* Resumo Geral */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="p-3.5 rounded-xl border bg-card/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-xs font-medium">Total Recuperados</span>
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold text-foreground">
                {report?.summary.total_recovered ?? 0}
              </span>
              <span className="text-[11px] text-muted-foreground">pacientes</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl border bg-card/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-xs font-medium">Pendências Criadas</span>
              <Clock className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold text-foreground">
                {report?.summary.total_pending ?? 0}
              </span>
              <span className="text-[11px] text-muted-foreground">no período</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl border bg-card/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-muted-foreground mb-1">
              <span className="text-xs font-medium">Taxa de Recuperação</span>
              <TrendingUp className="w-3.5 h-3.5 text-violet-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                {report?.summary.recovery_rate ?? 0}%
              </span>
              <span className="text-[11px] text-muted-foreground">eficiência</span>
            </div>
          </div>
        </div>

        {/* Detalhamento por Regra */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Desempenho por Regra de Cuidado
            </h4>
            <span className="text-[11px] text-muted-foreground">
              {report?.rules.length || 0} regras monitoradas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {report?.rules.map((rule) => {
              const rate = rule.recovery_rate || 0
              return (
                <div
                  key={rule.id}
                  className="p-3.5 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-tight">
                        {rule.displayName || rule.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Janela: {rule.followup_days} dias
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-semibold ${
                        rate >= 70
                          ? 'border-emerald-500/40 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : rate >= 40
                            ? 'border-amber-500/40 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'border-slate-300 text-slate-700 bg-slate-50 dark:bg-slate-900/40 dark:text-slate-300'
                      }`}
                    >
                      {rate}% taxa
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{rule.recovered_count} recuperados</span>
                      <span>{rule.created_pending} pendências</span>
                    </div>
                    <Progress value={rate} className="h-2 rounded-full" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Lista de Pacientes Recuperados Recentemente */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pacientes Recuperados Recentemente
              </h4>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {report?.recent_recovered.length || 0} encontrados
            </span>
          </div>

          {report?.recent_recovered && report.recent_recovered.length > 0 ? (
            <ScrollArea className="h-56 rounded-xl border bg-muted/10 p-2">
              <div className="space-y-1.5">
                {report.recent_recovered.map((patient, idx) => {
                  let formattedDate = ''
                  try {
                    formattedDate = format(new Date(patient.recovered_at), "dd 'de' MMM, HH:mm", {
                      locale: ptBR,
                    })
                  } catch (_) {
                    formattedDate = patient.recovered_at || 'Recentemente'
                  }

                  return (
                    <div
                      key={patient.contact_id + '_' + idx}
                      className="p-2.5 rounded-lg border bg-card hover:bg-muted/40 transition-colors flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {patient.name}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] py-0 px-1.5 font-normal"
                          >
                            {patient.rule_name}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {patient.reason} • {formattedDate}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {patient.phone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-emerald-600 hover:text-emerald-700 min-h-[36px] sm:min-h-0"
                            onClick={() => {
                              window.open(
                                `https://wa.me/${patient.phone.replace(/\D/g, '')}`,
                                '_blank',
                              )
                            }}
                          >
                            <MessageCircle className="w-3 h-3 mr-1" />
                            WhatsApp
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0"
                          onClick={() => {
                            navigate(`/crm?search=${encodeURIComponent(patient.name)}`)
                          }}
                          title="Ver no CRM"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="p-6 text-center border rounded-xl bg-muted/10">
              <p className="text-xs text-muted-foreground">
                Nenhum paciente recuperado registrado nos últimos {days} dias.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
