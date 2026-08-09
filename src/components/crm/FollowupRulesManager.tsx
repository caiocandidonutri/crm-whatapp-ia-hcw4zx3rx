import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Check, X, Clock, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  getFollowupRules,
  createFollowupRule,
  updateFollowupRule,
  deleteFollowupRule,
} from '@/services/care_followup_rules_service'
import { useRealtime } from '@/hooks/use-realtime'
import type { CareFollowupRule } from '@/types/models'

interface FollowupRulesManagerProps {
  accountId: string
}

export function FollowupRulesManager({ accountId }: FollowupRulesManagerProps) {
  const [rules, setRules] = useState<CareFollowupRule[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newDays, setNewDays] = useState('10')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDays, setEditDays] = useState('')
  const [editReminder, setEditReminder] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getFollowupRules(accountId)
      setRules(data)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])

  useRealtime('care_followup_rules', () => load(), !!accountId)

  const handleAdd = async () => {
    if (!newName.trim() || !newDays) return
    try {
      await createFollowupRule(accountId, {
        name: newName.trim(),
        followup_days: Math.max(1, Number(newDays) || 10),
      })
      setNewName('')
      setNewDays('10')
      load()
      toast.success('Tipo de procedimento adicionado')
    } catch {
      toast.error('Erro ao adicionar')
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim() || !editDays) return
    try {
      await updateFollowupRule(id, {
        name: editName.trim(),
        followup_days: Math.max(1, Number(editDays) || 10),
        reminder_text: editReminder.trim(),
      })
      setEditingId(null)
      load()
      toast.success('Atualizado')
    } catch {
      toast.error('Erro ao atualizar')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteFollowupRule(id)
      load()
      toast.success('Removido')
    } catch {
      toast.error('Erro ao remover')
    }
  }

  const startEdit = (rule: CareFollowupRule) => {
    setEditingId(rule.id)
    setEditName(rule.name)
    setEditDays(String(rule.followup_days))
    setEditReminder(rule.reminder_text || '')
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Tipos de Procedimento
      </h3>
      <p className="text-xs text-muted-foreground">
        Configure o período de follow-up e o lembrete 24h personalizado para cada procedimento.
      </p>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border border-border/40 p-2">
              {editingId === rule.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 text-sm flex-1"
                    />
                    <Input
                      type="number"
                      value={editDays}
                      onChange={(e) => setEditDays(e.target.value)}
                      className="h-8 text-sm w-16"
                      min={1}
                      max={365}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleUpdate(rule.id)}
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    value={editReminder}
                    onChange={(e) => setEditReminder(e.target.value)}
                    placeholder="Lembrete 24h personalizado... Use {nome}, {data}, {horario}"
                    className="h-16 text-xs resize-none"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Placeholders: {'{nome}'}, {'{data}'}, {'{horario}'}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1">{rule.name}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {rule.followup_days} dias
                  </span>
                  {rule.reminder_text ? (
                    <MessageSquare className="w-3 h-3 text-primary shrink-0" />
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => startEdit(rule)}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => handleDelete(rule.id)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Separator />
      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Novo tipo de procedimento..."
          className="h-8 text-sm flex-1"
        />
        <Input
          type="number"
          value={newDays}
          onChange={(e) => setNewDays(e.target.value)}
          className="h-8 text-sm w-20"
          min={1}
          max={365}
        />
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0"
          onClick={handleAdd}
          disabled={!newName.trim()}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
