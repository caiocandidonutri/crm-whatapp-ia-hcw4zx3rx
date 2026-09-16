import { useState, useEffect } from 'react'
import { HeartHandshake, Save, Loader2, Sparkles, MessageSquare } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { getCareAlertSettings, saveCareAlertSettings } from '@/services/care_alerts_service'
import { toast } from 'sonner'

type SurveySettingsManagerProps = {
  accountId: string
}

export function SurveySettingsManager({ accountId }: SurveySettingsManagerProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [q1, setQ1] = useState('De 0 a 10, como foi sua experiência com a gente hoje? 💚')
  const [q2, setQ2] = useState('Tem algo que poderíamos melhorar no seu atendimento?')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const settings = await getCareAlertSettings(accountId)
        if (!active) return
        if (settings) {
          setEnabled(settings.survey_enabled ?? true)
          if (settings.survey_q1) setQ1(settings.survey_q1)
          if (settings.survey_q2) setQ2(settings.survey_q2)
        }
      } catch (err) {
        console.error('Erro ao carregar configurações de pesquisa:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [accountId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q1.trim() || !q2.trim()) {
      toast.error('As duas perguntas devem ser preenchidas.')
      return
    }

    setSaving(true)
    try {
      await saveCareAlertSettings(accountId, {
        survey_enabled: enabled,
        survey_q1: q1.trim(),
        survey_q2: q2.trim(),
      })
      toast.success('Configurações da pesquisa pós-consulta salvas com sucesso!')
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err?.message || 'Tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border/60 bg-white/70 shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
                <HeartHandshake className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg font-bold text-primary">
                Pesquisa de Satisfação Pós-Consulta (2 Perguntas)
              </CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm">
              Enviada automaticamente ~3h após a realização da consulta pelo WhatsApp da Fabiana. No
              dia 1º de cada mês, um resumo é entregue ao Dr. Caio na Central de Tarefas.
            </CardDescription>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto bg-card p-2 rounded-xl border border-border/60">
            <Switch id="survey-switch" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="survey-switch" className="text-xs font-semibold cursor-pointer">
              {enabled ? 'Pesquisa Ativa' : 'Pesquisa Desativada'}
            </Label>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {loading ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
            Carregando configurações da pesquisa...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div className="p-4 rounded-xl border bg-emerald-50/50 border-emerald-200/60 text-xs space-y-2">
              <div className="flex items-center gap-2 font-semibold text-emerald-900">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>Como funciona o disparo e o resumo:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-emerald-950/80 leading-relaxed">
                <li>
                  Disparo às 14:37 (horário seguro e escalonado) para consultas marcadas como{' '}
                  <strong>realizadas</strong>.
                </li>
                <li>
                  Parser inteligente: captura nota (0 a 10) e feedback de melhoria em uma única
                  mensagem.
                </li>
                <li>
                  Idempotência: nunca repete para o mesmo agendamento nem se o paciente não
                  responder em 48h.
                </li>
                <li>
                  Resumo mensal: no dia 1º às 09:23, cria tarefa prioritária com média, taxa de
                  resposta, NPS e destaques.
                </li>
              </ul>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="q1" className="text-xs font-semibold">
                  Pergunta 1: Avaliação / Nota de 0 a 10 *
                </Label>
                <Textarea
                  id="q1"
                  value={q1}
                  onChange={(e) => setQ1(e.target.value)}
                  rows={2}
                  className="text-xs sm:text-sm"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q2" className="text-xs font-semibold">
                  Pergunta 2: Sugestão de melhoria / Feedback qualitativo *
                </Label>
                <Textarea
                  id="q2"
                  value={q2}
                  onChange={(e) => setQ2(e.target.value)}
                  rows={2}
                  className="text-xs sm:text-sm"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <span>Tom humano da secretária Fabiana (nunca se identifica como IA/robô).</span>
              </div>

              <Button type="submit" disabled={saving} className="gap-2 shadow-sm">
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Salvar Configurações da Pesquisa</span>
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
