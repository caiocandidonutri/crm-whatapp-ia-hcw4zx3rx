import { useMemo } from 'react'
import { FileText, Sparkles, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useMessageTemplates } from '@/hooks/use-message-templates'
import type { MessageTemplate } from '@/types/models'
import type { TriggerType } from '@/services/message_templates'

const TRIGGER_LABELS: Record<TriggerType, string> = {
  primeiro_contato: 'Primeiro Contato',
  reengajamento: 'Reengajamento',
  pos_consulta: 'Pós-consulta',
}

const TRIGGER_ORDER: TriggerType[] = ['primeiro_contato', 'reengajamento', 'pos_consulta']

type TemplatePickerProps = {
  accountId?: string
  hasMessages: boolean
  lastMessageTimestamp?: string
  onSelect: (content: string) => void
  onManage?: () => void
}

export function TemplatePicker({
  accountId,
  hasMessages,
  lastMessageTimestamp,
  onSelect,
  onManage,
}: TemplatePickerProps) {
  const { templates, loading } = useMessageTemplates(accountId)

  const suggestedType = useMemo<TriggerType | null>(() => {
    if (!hasMessages) return 'primeiro_contato'
    if (lastMessageTimestamp) {
      const lastTs = new Date(lastMessageTimestamp).getTime()
      if (!isNaN(lastTs)) {
        const hoursSince = (Date.now() - lastTs) / (1000 * 60 * 60)
        if (hoursSince > 24) return 'reengajamento'
      }
    }
    return 'pos_consulta'
  }, [hasMessages, lastMessageTimestamp])

  const grouped = useMemo(() => {
    const map = new Map<TriggerType, MessageTemplate[]>()
    for (const t of templates) {
      if (!map.has(t.trigger_type)) map.set(t.trigger_type, [])
      map.get(t.trigger_type)!.push(t)
    }
    return map
  }, [templates])

  if (loading || templates.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full shrink-0 text-muted-foreground hover:text-primary"
          title="Modelos de mensagem"
        >
          <FileText className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 rounded-2xl" align="start" sideOffset={12}>
        <div className="px-3 py-2.5 border-b flex items-center justify-between">
          <span className="text-sm font-semibold">Modelos</span>
          {onManage && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onManage}>
              <Plus className="w-3 h-3 mr-1" />
              Gerenciar
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          <div className="p-2 space-y-3">
            {TRIGGER_ORDER.map((type) => {
              const items = grouped.get(type) || []
              if (items.length === 0) return null
              return (
                <div key={type} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {TRIGGER_LABELS[type]}
                    </span>
                    {suggestedType === type && (
                      <Badge className="text-[9px] h-4 px-1 bg-primary text-primary-foreground">
                        <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                        Sugerido
                      </Badge>
                    )}
                  </div>
                  {items.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onSelect(t.content)}
                      className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors text-sm group"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="font-medium truncate">{t.name}</p>
                        {t.is_fabiana_voice && (
                          <Badge
                            variant="secondary"
                            className="bg-purple-100 text-purple-700 border-purple-200 text-[9px] h-4 px-1 shrink-0 font-medium"
                            title="Modelo com tom de voz da Fabiana"
                          >
                            <Sparkles className="w-2 h-2 mr-0.5 text-purple-600" />
                            Voz Fabiana
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {t.content}
                      </p>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
