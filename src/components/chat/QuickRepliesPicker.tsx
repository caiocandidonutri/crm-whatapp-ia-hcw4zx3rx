import { useState, useMemo, useEffect } from 'react'
import { Zap, Search, Settings2, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useQuickReplies } from '@/hooks/use-quick-replies'
import type { QuickReply } from '@/types/models'

type QuickRepliesPickerProps = {
  accountId?: string
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: (body: string) => void
  onManage?: () => void
  filterQuery?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  valores: 'Valores e Pagamento',
  local: 'Unidades e Local',
  preparo: 'Preparo de Exames',
  agendamento: 'Agendamentos',
  geral: 'Geral e Boas-vindas',
}

export function QuickRepliesPicker({
  accountId,
  isOpen,
  onOpenChange,
  onSelect,
  onManage,
  filterQuery = '',
}: QuickRepliesPickerProps) {
  const { replies, loading } = useQuickReplies(accountId)
  const [internalOpen, setInternalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const open = isOpen !== undefined ? isOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (onOpenChange) onOpenChange(val)
    else setInternalOpen(val)
  }

  // Se vier filterQuery externo (ex: digitado após "/"), sincroniza com a busca
  useEffect(() => {
    if (filterQuery !== undefined && filterQuery !== search) {
      setSearch(filterQuery)
    }
  }, [filterQuery])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of replies) {
      if (r.category) set.add(r.category)
    }
    return Array.from(set)
  }, [replies])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return replies.filter((r) => {
      if (activeCategory !== 'all' && (r.category || 'geral') !== activeCategory) {
        return false
      }
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        (r.shortcut && r.shortcut.toLowerCase().includes(q)) ||
        r.body.toLowerCase().includes(q) ||
        (r.category && r.category.toLowerCase().includes(q))
      )
    })
  }, [replies, activeCategory, search])

  const handlePick = (reply: QuickReply) => {
    onSelect(reply.body)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full shrink-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          title="Respostas Rápidas (templates da Fabiana) — ou digite / no campo"
        >
          <Zap className="w-5 h-5 fill-amber-500/20" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-0 rounded-2xl shadow-xl border-border/80"
        align="start"
        sideOffset={12}
      >
        <div className="p-3 border-b bg-muted/20 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span>Respostas Rápidas (Fabiana)</span>
            </div>
            {onManage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 text-muted-foreground hover:text-primary gap-1"
                onClick={() => {
                  setOpen(false)
                  onManage()
                }}
              >
                <Settings2 className="w-3.5 h-3.5" />
                Gerenciar
              </Button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por atalho (/valor) ou palavra..."
              className="h-8 pl-8 pr-3 text-xs bg-background/80 rounded-lg"
              autoFocus
            />
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveCategory('all')}
                className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors shrink-0 ${
                  activeCategory === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                Todas
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors shrink-0 capitalize ${
                    activeCategory === cat
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <ScrollArea className="h-[280px]">
          <div className="p-2 space-y-1">
            {loading && replies.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Carregando respostas...
              </p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 px-4 text-xs text-muted-foreground space-y-1">
                <p>Nenhuma resposta encontrada.</p>
                {search && <p className="opacity-75">Tente outro termo ou atalho.</p>}
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handlePick(r)}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-muted/60 transition-colors text-sm group flex flex-col gap-1 border border-transparent hover:border-border/60"
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="font-medium text-xs text-foreground group-hover:text-primary transition-colors">
                      {r.title}
                    </span>
                    {r.shortcut && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono h-4 px-1.5 bg-amber-100/70 text-amber-800 border-amber-200/60 shrink-0"
                      >
                        <Hash className="w-2.5 h-2.5 mr-0.5 inline" />
                        {r.shortcut.replace(/^\//, '')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {r.body}
                  </p>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t bg-muted/10 text-[11px] text-muted-foreground text-center">
          Dica: clique para carregar no campo e personalizar antes de enviar.
        </div>
      </PopoverContent>
    </Popover>
  )
}
