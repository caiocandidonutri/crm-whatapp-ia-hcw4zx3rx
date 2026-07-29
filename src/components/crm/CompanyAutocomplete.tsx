import React, { useState, useEffect, useRef } from 'react'
import { Building2, Plus, X, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CrmCompany } from '@/types/models'
import { searchCrmCompanies, createCrmCompany } from '@/services/crm_companies_service'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Props = {
  /** Empresa atualmente vinculada — quando setada, mostra pill ao invés do input. */
  selectedCompany?: CrmCompany | null
  /** Chamada quando user seleciona uma empresa, cria nova, ou desvincula (null). */
  onChange: (company: CrmCompany | null) => void | Promise<void>
  disabled?: boolean
  className?: string
}

/**
 * Autocomplete de empresas com opção "Criar nova" inline. Usado no
 * detail do contato pra vincular empresa em um único campo.
 *
 * Quando há empresa selecionada, mostra como pill com ícone + nome +
 * X pra desvincular. Quando não, mostra input com dropdown que busca
 * em crm_companies por nome (debounce 250ms) e oferece criar empresa
 * nova com o nome digitado caso não haja match exato.
 */
export function CompanyAutocomplete({ selectedCompany, onChange, disabled, className }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CrmCompany[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [creating, setCreating] = useState(false)
  const [searching, setSearching] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const items = await searchCrmCompanies(query)
        setResults(items)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // Cleanup do timer de blur ao desmontar
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    }
  }, [])

  const handleSelect = async (company: CrmCompany) => {
    setShowDropdown(false)
    setQuery('')
    await onChange(company)
  }

  const handleCreate = async () => {
    const name = query.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const created = await createCrmCompany({ name })
      toast.success(`Empresa "${created.name}" criada`)
      setShowDropdown(false)
      setQuery('')
      await onChange(created)
    } catch {
      toast.error('Erro ao criar empresa')
    } finally {
      setCreating(false)
    }
  }

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    await onChange(null)
  }

  // Pill de empresa selecionada
  if (selectedCompany) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg',
          className,
        )}
      >
        <Building2 className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 text-sm font-medium text-primary truncate">
          {selectedCompany.name}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
          onClick={handleClear}
          disabled={disabled}
          aria-label="Desvincular empresa"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    )
  }

  const trimmed = query.trim()
  const exactMatch = results.find((r) => r.name.toLowerCase() === trimmed.toLowerCase())
  const showCreateOption = trimmed.length > 0 && !exactMatch && !searching

  return (
    <div className={cn('relative', className)}>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          // Delay pra não fechar antes do click no dropdown registrar.
          blurTimerRef.current = setTimeout(() => setShowDropdown(false), 200)
        }}
        placeholder="Buscar ou criar empresa…"
        disabled={disabled}
        className="bg-white/50"
      />

      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {searching && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Buscando…
            </div>
          )}

          {!searching &&
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  // mouseDown ao invés de click pra disparar antes do blur
                  // do input (que esconderia o dropdown).
                  e.preventDefault()
                  handleSelect(c)
                }}
                className="w-full px-3 py-2 text-left hover:bg-primary/5 flex items-center gap-2 text-sm"
              >
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
              </button>
            ))}

          {showCreateOption && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                handleCreate()
              }}
              disabled={creating}
              className={cn(
                'w-full px-3 py-2 text-left hover:bg-primary/5 flex items-center gap-2 text-sm',
                results.length > 0 && 'border-t border-border',
              )}
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
              ) : (
                <Plus className="w-4 h-4 text-primary shrink-0" />
              )}
              <span className="flex-1 truncate">
                Criar empresa: <strong className="text-primary">{trimmed}</strong>
              </span>
            </button>
          )}

          {!searching && !trimmed && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              Digite um nome pra buscar ou criar
            </div>
          )}

          {!searching && trimmed && !showCreateOption && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              Nenhuma empresa encontrada
            </div>
          )}
        </div>
      )}
    </div>
  )
}
