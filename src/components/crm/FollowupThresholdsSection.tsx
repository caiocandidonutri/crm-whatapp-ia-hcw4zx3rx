import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  getFollowupThresholds,
  upsertFollowupThreshold,
  FOLLOWUP_CATEGORY_META,
  type FollowupCategory,
} from '@/services/care_followup_thresholds'
import { useRealtime } from '@/hooks/use-realtime'
import type { CareFollowupThreshold } from '@/types/models'

interface Props {
  accountId: string
}

type DraftMap = Record<FollowupCategory, { days: string; enabled: boolean; id?: string }>

const DEFAULT_DRAFT: DraftMap = {
  nao_respondeu: { days: '3', enabled: true },
  precisa_atencao: { days: '7', enabled: true },
  perdido: { days: '15', enabled: true },
}

export function FollowupThresholdsSection({ accountId }: Props) {
  const [draft, setDraft] = useState<DraftMap>({
    nao_respondeu: { days: '3', enabled: true },
    precisa_atencao: { days: '7', enabled: true },
    perdido: { days: '15', enabled: true },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const data: CareFollowupThreshold[] = await getFollowupThresholds(accountId)
      const next: DraftMap = {
        nao_respondeu: { days: '3', enabled: true },
        precisa_atencao: { days: '7', enabled: true },
        perdido: { days: '15', enabled: true },
      }
      for (const t of data) {
        if (next[t.category as FollowupCategory]) {
          next[t.category as FollowupCategory] = {
            days: String(t.days ?? DEFAULT_DRAFT[t.category].days),
            enabled: t.enabled ?? true,
            id: t.id,
          }
        }
      }
      setDraft(next)
    } catch {
      /* mantém defaults */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])
  useRealtime('care_followup_thresholds', () => load(), !!accountId)

  const handleSave = async (category: FollowupCategory) => {
    const entry = draft[category]
    const days = Math.max(1, Number(entry.days) || 1)
    setSaving(true)
    try {
      await upsertFollowupThreshold(accountId, {
        category,
        days,
        enabled: entry.enabled,
      })
      toast.success('Regra de follow-up salva')
      load()
    } catch {
      toast.error('Erro ao salvar regra')
    } finally {
      setSaving(false)
    }
  }

  const setDays = (category: FollowupCategory, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [category]: { ...prev[category], days: value },
    }))
  }

  const setEnabled = (category: FollowupCategory, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      [category]: { ...prev[category], enabled: value },
    }))
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Regras de Follow-up
      </h3>
      <p className="text-xs text-muted-foreground">
        Defina após quantos dias sem resposta do paciente ele entra em cada categoria de cuidado.
      </p>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {FOLLOWUP_CATEGORY_META.map((meta) => {
            const entry = draft[meta.id]
            return (
              <div key={meta.id} className="rounded-lg border border-border/40 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <p className="text-[10px] text-muted-foreground/70 leading-tight">
                      {meta.description}
                    </p>
                  </div>
                  <Switch checked={entry.enabled} onCheckedChange={(v) => setEnabled(meta.id, v)} />
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={entry.days}
                      onChange={(e) => setDays(meta.id, e.target.value)}
                      disabled={!entry.enabled}
                      className="h-8 w-16 text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">dias</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    disabled={saving}
                    onClick={() => handleSave(meta.id)}
                    title="Salvar"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {saving && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Salvando...
        </div>
      )}
    </div>
  )
}
