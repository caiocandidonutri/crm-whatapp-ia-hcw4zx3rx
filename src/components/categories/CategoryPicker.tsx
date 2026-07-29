import React, { useState } from 'react'
import { Check, Tags, Plus, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Category } from '@/types/models'
import { CATEGORY_COLOR_MAP, CATEGORY_COLORS } from '@/lib/colors'
import { createCategory } from '@/services/categories'
import { useAuth } from '@/hooks/use-auth'
import { toast } from 'sonner'

type Props = {
  categories: Category[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  className?: string
}

export function CategoryPicker({ categories, selectedIds, onChange, disabled, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const { user } = useAuth()

  const selectedCats = categories.filter((c) => selectedIds.includes(c.id))

  const trimmed = query.trim()
  const exactMatch = categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  // Oferece criar inline assim que o user digita um nome inexistente. O
  // account_id é resolvido no service (createCategory), então não dependemos
  // do hook de conta já ter carregado aqui.
  const canCreate = trimmed.length > 0 && !exactMatch

  const handleCreate = async () => {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      // Cor automática rotacionando a paleta pra não repetir sempre a mesma.
      const color = CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]
      const created = await createCategory({
        name: trimmed,
        color,
        created_by: user?.id,
      })
      onChange([...selectedIds, created.id])
      setQuery('')
      toast.success(`Categoria "${created.name}" criada`)
    } catch {
      toast.error('Erro ao criar categoria')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-9 justify-start', className)}
          disabled={disabled}
        >
          <Tags className="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
          {selectedCats.length > 0 ? (
            <div className="flex items-center gap-1 overflow-hidden">
              {selectedCats.slice(0, 2).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-xs truncate max-w-[80px]"
                >
                  <div
                    className={cn('w-1.5 h-1.5 rounded-full shrink-0', CATEGORY_COLOR_MAP[c.color])}
                  />
                  <span className="truncate">{c.name}</span>
                </div>
              ))}
              {selectedCats.length > 2 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  +{selectedCats.length - 2}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground font-normal">Categorias</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Buscar ou criar categoria..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!canCreate && <CommandEmpty>Nenhuma encontrada.</CommandEmpty>}
            <CommandGroup>
              {categories.map((cat) => {
                const isSelected = selectedIds.includes(cat.id)
                return (
                  <CommandItem
                    key={cat.id}
                    value={cat.name}
                    onSelect={() => {
                      if (isSelected) {
                        onChange(selectedIds.filter((id) => id !== cat.id))
                      } else {
                        onChange([...selectedIds, cat.id])
                      }
                    }}
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded-sm flex items-center justify-center border mr-2 shrink-0',
                        isSelected ? 'bg-primary border-primary' : 'border-border',
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full mr-2 shrink-0',
                        CATEGORY_COLOR_MAP[cat.color],
                      )}
                    />
                    <span className="truncate">{cat.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>

            {canCreate && (
              <CommandGroup className="border-t">
                <CommandItem
                  value={`criar ${trimmed}`}
                  onSelect={handleCreate}
                  disabled={creating}
                  className="text-primary aria-selected:bg-primary/5"
                >
                  {creating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2 shrink-0" />
                  )}
                  <span className="truncate">
                    Criar categoria: <strong>{trimmed}</strong>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
