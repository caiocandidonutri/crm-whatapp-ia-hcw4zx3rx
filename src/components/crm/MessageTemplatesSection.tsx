import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  getMessageTemplates,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  type TriggerType,
} from '@/services/message_templates'
import { useRealtime } from '@/hooks/use-realtime'
import { extractFieldErrors, type FieldErrors } from '@/lib/pocketbase/errors'
import type { MessageTemplate } from '@/types/models'

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: 'primeiro_contato', label: 'Primeiro Contato' },
  { value: 'reengajamento', label: 'Reengajamento' },
  { value: 'pos_consulta', label: 'Pós-consulta' },
]

interface Props {
  accountId: string
}

export function MessageTemplatesSection({ accountId }: Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<TriggerType>('primeiro_contato')
  const [content, setContent] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const load = useCallback(async () => {
    try {
      setTemplates(await getMessageTemplates(accountId))
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [accountId])

  useEffect(() => {
    load()
  }, [load])
  useRealtime('message_templates', () => load(), !!accountId)

  const startNew = () => {
    setEditingId(null)
    setName('')
    setTriggerType('primeiro_contato')
    setContent('')
    setFieldErrors({})
    setShowForm(true)
  }

  const startEdit = (t: MessageTemplate) => {
    setEditingId(t.id)
    setName(t.name)
    setTriggerType(t.trigger_type)
    setContent(t.content)
    setFieldErrors({})
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFieldErrors({})
  }

  const handleSubmit = async () => {
    setFieldErrors({})
    try {
      if (editingId) {
        await updateMessageTemplate(editingId, {
          name: name.trim(),
          trigger_type: triggerType,
          content: content.trim(),
        })
        toast.success('Modelo atualizado')
      } else {
        await createMessageTemplate(accountId, {
          name: name.trim(),
          trigger_type: triggerType,
          content: content.trim(),
        })
        toast.success('Modelo criado')
      }
      cancelForm()
      load()
    } catch (err) {
      setFieldErrors(extractFieldErrors(err))
      toast.error('Erro ao salvar modelo')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMessageTemplate(id)
      load()
      toast.success('Modelo removido')
    } catch {
      toast.error('Erro ao remover')
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
        Modelos de Mensagem
      </h3>
      <p className="text-xs text-muted-foreground">
        Crie modelos por gatilho com variáveis dinâmicas.
      </p>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {TRIGGER_TYPES.map((tt) => {
            const items = templates.filter((t) => t.trigger_type === tt.value)
            return (
              <div key={tt.value} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{tt.label}</p>
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground/60 italic">Nenhum modelo</p>
                )}
                {items.map((t) => (
                  <div key={t.id} className="rounded-lg border border-border/40 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{t.name}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startEdit(t)}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleDelete(t.id)}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                      {t.content}
                    </p>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {showForm ? (
        <div className="space-y-2 rounded-lg border border-border/40 p-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do modelo"
            className="h-8 text-sm"
          />
          {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          <Select value={triggerType} onValueChange={(v) => setTriggerType(v as TriggerType)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_TYPES.map((tt) => (
                <SelectItem key={tt.value} value={tt.value}>
                  {tt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.trigger_type && (
            <p className="text-xs text-destructive">{fieldErrors.trigger_type}</p>
          )}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Mensagem..."
            className="h-20 text-xs resize-none"
          />
          {fieldErrors.content && <p className="text-xs text-destructive">{fieldErrors.content}</p>}
          <p className="text-[10px] text-muted-foreground">
            Variáveis: {'{nome}'}, {'{data}'}, {'{horario}'}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelForm}>
              <X className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={!name.trim() || !content.trim()}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="w-full" onClick={startNew}>
          <Plus className="w-4 h-4 mr-1" /> Novo modelo
        </Button>
      )}
    </div>
  )
}
