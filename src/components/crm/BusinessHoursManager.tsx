import { useState, useEffect } from 'react'
import { Clock, Moon, Check, Loader2, Save } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getBusinessHours, saveBusinessHour } from '@/services/business_hours'
import { getCareAlertSettings, saveCareAlertSettings } from '@/services/care_alerts_service'
import type { BusinessHour } from '@/types/models'
import { toast } from 'sonner'

type BusinessHoursManagerProps = {
  accountId: string
}

const DIAS_SEMANA = [
  { dia: 1, nome: 'Segunda-feira' },
  { dia: 2, nome: 'Terça-feira' },
  { dia: 3, nome: 'Quarta-feira' },
  { dia: 4, nome: 'Quinta-feira' },
  { dia: 5, nome: 'Sexta-feira' },
  { dia: 6, nome: 'Sábado' },
  { dia: 0, nome: 'Domingo' },
]

export function BusinessHoursManager({ accountId }: BusinessHoursManagerProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [afterHoursEnabled, setAfterHoursEnabled] = useState(true)
  const [hours, setHours] = useState<
    Record<number, { ativo: boolean; abre: string; fecha: string }>
  >({
    0: { ativo: false, abre: '08:00', fecha: '12:00' },
    1: { ativo: true, abre: '08:00', fecha: '18:00' },
    2: { ativo: true, abre: '08:00', fecha: '18:00' },
    3: { ativo: true, abre: '08:00', fecha: '18:00' },
    4: { ativo: true, abre: '08:00', fecha: '18:00' },
    5: { ativo: true, abre: '08:00', fecha: '18:00' },
    6: { ativo: true, abre: '08:00', fecha: '12:00' },
  })

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      try {
        const [bhList, settings] = await Promise.all([
          getBusinessHours(accountId),
          getCareAlertSettings(accountId),
        ])
        if (!active) return

        if (settings) {
          setAfterHoursEnabled(settings.after_hours_enabled ?? true)
        }

        if (bhList && bhList.length > 0) {
          const map: Record<number, { ativo: boolean; abre: string; fecha: string }> = {}
          for (const item of bhList) {
            map[item.dia_semana] = {
              ativo: item.ativo,
              abre: item.abre || '08:00',
              fecha: item.fecha || '18:00',
            }
          }
          setHours((prev) => ({ ...prev, ...map }))
        }
      } catch (err) {
        console.error('Erro ao carregar configurações de horário:', err)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [accountId])

  const handleToggleDay = (dia: number) => {
    setHours((prev) => ({
      ...prev,
      [dia]: {
        ...prev[dia],
        ativo: !prev[dia].ativo,
      },
    }))
  }

  const handleTimeChange = (dia: number, field: 'abre' | 'fecha', val: string) => {
    setHours((prev) => ({
      ...prev,
      [dia]: {
        ...prev[dia],
        [field]: val,
      },
    }))
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      await saveCareAlertSettings(accountId, {
        after_hours_enabled: afterHoursEnabled,
      })

      const promises = DIAS_SEMANA.map((d) => {
        const h = hours[d.dia]
        return saveBusinessHour(accountId, d.dia, h.ativo, h.abre, h.fecha, 'Global')
      })
      await Promise.all(promises)

      toast.success('Horários e resposta automática fora do horário salvos!')
    } catch (err: any) {
      toast.error('Erro ao salvar horários: ' + (err?.message || 'Tente novamente'))
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
              <div className="p-2 bg-indigo-500/10 text-indigo-600 rounded-xl">
                <Moon className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg font-bold text-primary">
                Horário de Atendimento e Resposta Fora do Horário
              </CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm">
              Quando um paciente manda mensagem fora do expediente, a Fabiana envia uma acolhida
              única e coleta o motivo do contato.
            </CardDescription>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto bg-card p-2 rounded-xl border border-border/60">
            <Switch
              id="after-hours-switch"
              checked={afterHoursEnabled}
              onCheckedChange={setAfterHoursEnabled}
            />
            <Label htmlFor="after-hours-switch" className="text-xs font-semibold cursor-pointer">
              {afterHoursEnabled ? 'Resposta automática ativa' : 'Resposta automática pausada'}
            </Label>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {loading ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
            Carregando horários de funcionamento...
          </div>
        ) : (
          <>
            <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Clock className="w-4 h-4 text-indigo-500" />
                <span>Mensagem automática acolhedora enviada pela Fabiana:</span>
              </div>
              <p className="text-xs text-muted-foreground italic leading-relaxed bg-background/80 p-3 rounded-lg border border-border/40">
                &quot;Olá, &#123;Nome&#125;! Recebemos sua mensagem 💚 Neste momento a equipe do Dr.
                Caio está fora do horário de atendimento, mas já te respondemos no primeiro horário
                de amanhã. Enquanto isso, pode nos contar rapidinho o motivo do seu contato? (ex:
                consulta, retorno, valor, exame, outro)&quot;
              </p>
              <p className="text-[11px] text-muted-foreground">
                ✦ Anti-atropelamento: nunca responde se um funcionário falou recentemente na
                conversa. A resposta do paciente é gravada no CRM com chip &quot;Motivo do
                contato&quot;.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Grade Semanal de Expediente (Horário de Brasília)
              </h4>

              <div className="divide-y divide-border/40 border rounded-xl overflow-hidden bg-card/60">
                {DIAS_SEMANA.map((d) => {
                  const dayData = hours[d.dia] || { ativo: false, abre: '08:00', fecha: '18:00' }
                  return (
                    <div
                      key={d.dia}
                      className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 w-40">
                        <Switch
                          checked={dayData.ativo}
                          onCheckedChange={() => handleToggleDay(d.dia)}
                        />
                        <span className="font-semibold text-foreground">{d.nome}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {dayData.ativo ? (
                          <>
                            <span className="text-muted-foreground">Abre:</span>
                            <Input
                              type="time"
                              value={dayData.abre}
                              onChange={(e) => handleTimeChange(d.dia, 'abre', e.target.value)}
                              className="h-8 w-24 text-xs font-mono"
                            />
                            <span className="text-muted-foreground ml-2">Fecha:</span>
                            <Input
                              type="time"
                              value={dayData.fecha}
                              onChange={(e) => handleTimeChange(d.dia, 'fecha', e.target.value)}
                              className="h-8 w-24 text-xs font-mono"
                            />
                          </>
                        ) : (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            Fechado / Fora de expediente o dia todo
                          </Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button onClick={handleSaveAll} disabled={saving} className="gap-2 shadow-sm">
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Salvar Horários de Atendimento</span>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
