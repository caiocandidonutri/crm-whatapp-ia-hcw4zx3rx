import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import {
  MessageSquare,
  ListTodo,
  CalendarCheck,
  Bot,
  Scale,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Loader2,
  ShieldCheck,
  PhoneCall,
} from 'lucide-react'

interface OnboardingStepDef {
  key: string
  title: string
  route: string
  icon: React.ElementType
  actionLabel: string
  description: string
  detail: string
}

const OPERATIONAL_STEPS: OnboardingStepDef[] = [
  {
    key: 'whatsapp_connected',
    title: '1. WhatsApp Conectado',
    route: '/conversas',
    icon: PhoneCall,
    actionLabel: 'Ver Conexão',
    description: 'Instância oficial ativa e sincronizada para atendimento da clínica.',
    detail:
      'Verifique se o QR code foi lido e se a instância está recebendo e enviando mensagens sem interrupções.',
  },
  {
    key: 'fila_do_dia',
    title: '2. Fila do Dia',
    route: '/fila',
    icon: ListTodo,
    actionLabel: 'Acessar /fila',
    description: 'Organização diária das prioridades, triagens e contatos pendentes.',
    detail:
      'Acompanhe a fila dinâmica com filtros de hoje, pendentes e concluídos para garantir que nenhum paciente fique sem retorno.',
  },
  {
    key: 'confirmacao_agenda',
    title: '3. Confirmação de Agendamentos',
    route: '/agenda',
    icon: CalendarCheck,
    actionLabel: 'Abrir /agenda',
    description: 'Fluxo oficial de confirmação de horários sincronizados com Dr. Caio.',
    detail:
      'Push CRM→agenda oficial ocorre apenas após a confirmação pela secretária, respeitando horários e expediente clínico.',
  },
  {
    key: 'voz_fabiana_templates',
    title: '4. Templates "Voz da Fabiana" no Chat',
    route: '/conversas',
    icon: Bot,
    actionLabel: 'Ver no Chat',
    description: 'Modelos de respostas acolhedoras e empáticas prontas para uso.',
    detail:
      'A assistente virtual IA gera rascunhos inspirados no tom, repertório oficial e saudações acolhedoras da secretária Fabiana.',
  },
  {
    key: 'reconciliacao_reguas',
    title: '5. Fila de Reconciliação e Réguas',
    route: '/agenda',
    icon: Scale,
    actionLabel: 'Ver Reconciliação',
    description: 'Acompanhamento de orçamentos (7d), retorno e lembretes automáticos.',
    detail:
      'Monitoramento do Night Shield (21h–07h), kill-switch de emergência e reconciliação diária de agendamentos ambíguos.',
  },
]

export default function Recepcao() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({})
  const [recordId, setRecordId] = useState<string | null>(null)

  const currentUserId = pb.authStore.record?.id || ''

  useEffect(() => {
    let cancelled = false
    const loadProgress = async () => {
      setLoading(true)
      try {
        if (!currentUserId) {
          setLoading(false)
          return
        }

        // Buscar registro de onboarding_progress do usuário
        const records = await pb.collection('onboarding_progress').getFullList({
          filter: `user_id = "${currentUserId}"`,
          sort: '-updated',
          requestKey: null,
        })

        if (cancelled) return

        if (records.length > 0) {
          const rec = records[0]
          setRecordId(rec.id)
          const state: Record<string, boolean> = {}
          OPERATIONAL_STEPS.forEach((step) => {
            state[step.key] = rec.getBool ? rec.getBool(step.key) : Boolean((rec as any)[step.key])
          })
          setCompletedSteps(state)
        } else {
          // Criar registro inicial se não existir
          const initialData: Record<string, any> = {
            user_id: currentUserId,
            completed: false,
          }
          OPERATIONAL_STEPS.forEach((step) => {
            initialData[step.key] = false
          })
          try {
            const created = await pb.collection('onboarding_progress').create(initialData, {
              requestKey: null,
            })
            if (!cancelled) {
              setRecordId(created.id)
              setCompletedSteps({})
            }
          } catch {
            // Em caso de falha de criação (permissão ou duplicidade), apenas mantém vazio
          }
        }
      } catch (err) {
        console.error('Erro ao carregar progresso da recepção:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadProgress()
    return () => {
      cancelled = true
    }
  }, [currentUserId])

  const completedCount = OPERATIONAL_STEPS.filter((s) => completedSteps[s.key]).length
  const progressPercent = Math.round((completedCount / OPERATIONAL_STEPS.length) * 100)

  const handleToggleStep = async (stepKey: string, currentVal: boolean) => {
    const newVal = !currentVal
    setSavingKey(stepKey)

    // Atualização otimista
    const nextSteps = { ...completedSteps, [stepKey]: newVal }
    setCompletedSteps(nextSteps)

    const allDone = OPERATIONAL_STEPS.every((s) => nextSteps[s.key])

    try {
      if (recordId) {
        await pb.collection('onboarding_progress').update(
          recordId,
          {
            [stepKey]: newVal,
            completed: allDone,
          },
          { requestKey: null },
        )
      } else if (currentUserId) {
        const payload: Record<string, any> = {
          user_id: currentUserId,
          [stepKey]: newVal,
          completed: allDone,
        }
        const created = await pb.collection('onboarding_progress').create(payload, {
          requestKey: null,
        })
        setRecordId(created.id)
      }

      if (newVal) {
        toast.success('Etapa concluída!')
      }
    } catch (err: any) {
      // Reverter estado se falhar
      setCompletedSteps(completedSteps)
      toast.error('Erro ao salvar etapa: ' + (err?.message || 'tente novamente'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-serif text-3xl font-bold text-primary">Recepção</h1>
            <Badge
              variant="outline"
              className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold"
            >
              Checklist e rotinas operacionais
            </Badge>
          </div>
          <p className="text-muted-foreground font-sans text-sm md:text-base max-w-2xl">
            <strong>Recepção — checklist e rotinas operacionais.</strong> Abertura do dia, rotina da
            secretária Fabiana e acompanhamento assistido da clínica Dr. Caio.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/home')}
            className="rounded-full text-xs h-9"
          >
            Voltar ao Início
          </Button>
          <Button
            onClick={() => navigate('/conversas')}
            className="rounded-full text-xs h-9 bg-primary hover:bg-primary/90 text-white"
          >
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            Abrir Conversas
          </Button>
        </div>
      </div>

      {/* Card de Progresso Geral */}
      <Card className="border-border/60 shadow-sm bg-white/70 backdrop-blur-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg font-serif font-bold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                Prontidão da Recepção & Atendimento
              </CardTitle>
              <CardDescription>
                {completedCount} de {OPERATIONAL_STEPS.length} rotinas operacionais verificadas
              </CardDescription>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-primary font-mono">{progressPercent}%</span>
              <p className="text-[11px] text-muted-foreground">Progresso</p>
            </div>
          </div>
          <Progress value={progressPercent} className="h-2.5 mt-2 bg-muted" />
        </CardHeader>
        {progressPercent === 100 && (
          <CardContent className="pt-0 pb-4">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Parabéns!</strong> Todas as rotinas da recepção estão conferidas e prontas
                para a operação assistida da clínica.
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Lista de Passos Operacionais */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Rotinas Operacionais Reais
        </h2>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs">Carregando checklist operacional...</span>
          </div>
        ) : (
          OPERATIONAL_STEPS.map((step) => {
            const isDone = Boolean(completedSteps[step.key])
            const isSaving = savingKey === step.key
            const Icon = step.icon

            return (
              <Card
                key={step.key}
                className={`border transition-all duration-200 rounded-xl overflow-hidden ${
                  isDone
                    ? 'border-emerald-300 bg-emerald-50/20 shadow-xs'
                    : 'border-border/60 bg-white hover:border-primary/40 hover:shadow-xs'
                }`}
              >
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div className="pt-0.5">
                      <Checkbox
                        id={`check-${step.key}`}
                        checked={isDone}
                        disabled={isSaving}
                        onCheckedChange={() => handleToggleStep(step.key, isDone)}
                        className="h-5 w-5 rounded-md data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 border-muted-foreground/40"
                      />
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label
                          htmlFor={`check-${step.key}`}
                          className={`font-semibold text-base cursor-pointer ${
                            isDone ? 'line-through text-muted-foreground' : 'text-foreground'
                          }`}
                        >
                          {step.title}
                        </label>
                        {isDone && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-800 border-0 text-[10px] py-0 h-5"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Concluído
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-foreground/80 leading-snug">{step.description}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.detail}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(step.route)}
                      className="rounded-full text-xs font-medium h-8 px-3 text-primary border-primary/20 hover:bg-primary/5"
                    >
                      <Icon className="w-3.5 h-3.5 mr-1.5" />
                      {step.actionLabel}
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
