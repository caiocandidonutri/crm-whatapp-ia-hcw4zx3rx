import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Check, X, Moon, Clock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  getCareSilencePeriods,
  createCareSilencePeriod,
  updateCareSilencePeriod,
  deleteCareSilencePeriod,
} from '@/services/care_silence_periods'
import { useRealtime } from '@/hooks/use-realtime'
import { extractFieldErrors, type FieldErrors } from '@/lib/pocketbase/errors'
import { cn } from '@/lib/utils'
import type { CareSilencePeriod } from '@/types/models'

const WEEKDAYS = [
  { value: 0, label: 'D' },
  { value: 1, label: 'S' },
  { value: 2, label: 'T' },
  { value: 3, label: 'Q' },
  { value: 4, label: 'Q' },
  { value: 5, label: 'S' },
  { value: 6, label: 'S' },
]
const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface Props {
  accountId: string
}

export function SilencePeriodsSection({ accountId }: Props) {
  const [periods, setPeriods] = useState<CareSilencePeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [startTime, setStartTime] = useState('22:00')
  const [endTime, setEndTime] = useState('06:00')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [enabled, setEnabled] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const load = useCallback(async () => {
    try {
      setPeriods(await getCareSilencePeriods(accountId))
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])
  useRealtime('care_silence_periods', () => load(), !!accountId)

  const startNew = () => {
    setEditingId(null)
    setStartTime('22:00')
    setEndTime('06:00')
    setWeekdays([])
    setEnabled(true)
    setFieldErrors({})
    setShowForm(true)
  }

  const startEdit = (p: CareSilencePeriod) => {
    setEditingId(p.id)
    setStartTime(p.start_time)
    setEndTime(p.end_time)
    setWeekdays(p.weekdays || [])
    setEnabled(p.enabled)
    setFieldErrors({})
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFieldErrors({})
  }

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  const handleSubmit = async () => {
    setFieldErrors({})
    if (endTime === startTime) {
      setFieldErrors({ end_time: 'Horário de fim igual ao início' })
      return
    }
    try {
      const data = { start_time: startTime, end_time: endTime, weekdays, enabled }
      if (editingId) {
        await updateCareSilencePeriod(editingId, data)
        toast.success('Período atualizado')
      } else {
        await createCareSilencePeriod(accountId, data)
        toast.success('Período criado')
      }
      cancelForm()
      load()
    } catch (err) {
      setFieldErrors(extractFieldErrors(err))
      toast.error('Erro ao salvar período')
    }
  }

  const handleToggleEnabled = async (p: CareSilencePeriod) => {
    try {
      await updateCareSilencePeriod(p.id, { enabled: !p.enabled })
      load()
    } catch {
      toast.error('Erro ao atualizar')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteCareSilencePeriod(id)
      load()
      toast.success('Removido')
    } catch {
      toast.error('Erro ao remover')
    }
  }

  const formatWeekdays = (wd?: number[] | null) => {
    if (!wd || wd.length === 0) return 'Todos os dias'
    return [...wd]
      .sort()
      .map((d) => WEEKDAY_NAMES[d])
      .join(', ')
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Silenciar Alertas
      </h3>
      <p className="text-xs text-muted-foreground">
        Defina períodos em que nenhum alerta será enviado.
      </p>
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {periods.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">Nenhum período configurado</p>
          )}
          {periods.map((p) => (
            <div key={p.id} className="rounded-lg border border-border/40 p-2">
              <div className="flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">
                  {p.start_time} — {p.end_time}
                </span>
                <Switch checked={p.enabled} onCheckedChange={() => handleToggleEnabled(p)} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => startEdit(p)}
                >
                  <Clock className="w-3 h-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleDelete(p.id)}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/70 mt-1 ml-5">
                {formatWeekdays(p.weekdays)}
              </p>
            </div>
          ))}
        </div>
      )}
      {showForm ? (
        <div className="space-y-2 rounded-lg border border-border/40 p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Início</label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Fim</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          {fieldErrors.start_time && (
            <p className="text-xs text-destructive">{fieldErrors.start_time}</p>
          )}
          {fieldErrors.end_time && (
            <p className="text-xs text-destructive">{fieldErrors.end_time}</p>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Dias da semana</label>
            <div className="flex gap-1 mt-1">
              {WEEKDAYS.map((wd, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(wd.value)}
                  className={cn(
                    'w-7 h-7 rounded text-xs font-medium transition-colors',
                    weekdays.includes(wd.value)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {wd.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {weekdays.length === 0 ? 'Todos os dias' : `${weekdays.length} dia(s) selecionado(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-xs text-muted-foreground">Ativado</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelForm}>
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="w-full" onClick={startNew}>
          <Plus className="w-4 h-4 mr-1" /> Novo período
        </Button>
      )}
    </div>
  )
}
