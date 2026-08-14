import { useState, useEffect, useCallback } from 'react'
import { Moon, Save, Loader2, Copy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  getDaySilenceConfigs,
  saveDaySilenceConfigs,
  WEEKDAY_LABELS,
  type DaySilenceConfig,
} from '@/services/care_silence_periods'
import { useRealtime } from '@/hooks/use-realtime'
import { cn } from '@/lib/utils'

interface Props {
  accountId: string
}

/**
 * Tela de configuração de horários de silêncio por dia da semana.
 *
 * Apresenta um grid Segunda→Domingo onde cada dia tem:
 *  - switch de ativação
 *  - horário de início
 *  - horário de fim
 * Sábado e Domingo podem ter o dia inteiro como silêncio (00:00→23:59).
 *
 * A persistência agrupa dias com o mesmo intervalo para manter a
 * collection `care_silence_periods` compatível com os hooks de backend
 * existentes.
 */
export function SilencePeriodsSection({ accountId }: Props) {
  const [configs, setConfigs] = useState<DaySilenceConfig[]>(() =>
    WEEKDAY_LABELS.map((d) => ({
      weekday: d.value,
      enabled: true,
      start_time: '22:00',
      end_time: '08:00',
    })),
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Ordem de exibição: Segunda → Domingo
  const displayOrder = [1, 2, 3, 4, 5, 6, 0]

  const load = useCallback(async () => {
    try {
      const data = await getDaySilenceConfigs(accountId)
      // Merge com defaults: se não houver configuração para um dia,
      // usamos um default razoável (fim de semana = dia inteiro).
      const merged = WEEKDAY_LABELS.map((d) => {
        const found = data.find((c) => c.weekday === d.value)
        if (found) return found
        const isWeekend = d.value === 0 || d.value === 6
        return {
          weekday: d.value,
          enabled: isWeekend,
          start_time: isWeekend ? '00:00' : '22:00',
          end_time: isWeekend ? '23:59' : '08:00',
        }
      })
      setConfigs(merged)
    } catch {
      /* mantém defaults */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])
  useRealtime('care_silence_periods', () => load(), !!accountId)

  const updateDay = (weekday: number, patch: Partial<DaySilenceConfig>) => {
    setConfigs((prev) => prev.map((c) => (c.weekday === weekday ? { ...c, ...patch } : c)))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveDaySilenceConfigs(accountId, configs)
      toast.success('Horários de silêncio salvos')
      load()
    } catch {
      toast.error('Erro ao salvar horários')
    } finally {
      setSaving(false)
    }
  }

  const copyToAllDays = (source: DaySilenceConfig) => {
    setConfigs((prev) =>
      prev.map((c) => ({
        ...c,
        enabled: source.enabled,
        start_time: source.start_time,
        end_time: source.end_time,
      })),
    )
  }

  const setWeekendFullDay = () => {
    setConfigs((prev) =>
      prev.map((c) =>
        c.weekday === 0 || c.weekday === 6
          ? { ...c, enabled: true, start_time: '00:00', end_time: '23:59' }
          : c,
      ),
    )
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Horários de Silêncio
      </h3>
      <p className="text-xs text-muted-foreground">
        Durante estes horários, nenhum alerta automático será enviado nem mensagens automáticas
        disparadas. Configure por dia da semana.
      </p>

      <div className="space-y-1.5">
        {displayOrder.map((wd) => {
          const label = WEEKDAY_LABELS.find((d) => d.value === wd)!
          const cfg = configs.find((c) => c.weekday === wd)!
          const isFullDay = cfg.enabled && cfg.start_time === '00:00' && cfg.end_time === '23:59'
          return (
            <div
              key={wd}
              className={cn(
                'rounded-lg border p-2 transition-colors',
                cfg.enabled ? 'border-border/60 bg-muted/30' : 'border-border/30 opacity-70',
              )}
            >
              <div className="flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium w-16 shrink-0">{label.long}</span>
                <Switch
                  checked={cfg.enabled}
                  onCheckedChange={(v) => updateDay(wd, { enabled: v })}
                />
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <Input
                    type="time"
                    value={cfg.start_time}
                    onChange={(e) => updateDay(wd, { start_time: e.target.value })}
                    disabled={!cfg.enabled}
                    className="h-8 w-24 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input
                    type="time"
                    value={cfg.end_time}
                    onChange={(e) => updateDay(wd, { end_time: e.target.value })}
                    disabled={!cfg.enabled}
                    className="h-8 w-24 text-xs"
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copyToAllDays(cfg)}
                  title="Aplicar para todos os dias"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              {isFullDay && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 ml-5">
                  Dia inteiro em silêncio
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={setWeekendFullDay} className="text-xs">
          Fim de semana: dia inteiro
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="ml-auto">
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5 mr-1.5" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  )
}
