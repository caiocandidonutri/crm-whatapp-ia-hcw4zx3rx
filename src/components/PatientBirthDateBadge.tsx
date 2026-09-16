import React, { useState, useCallback } from 'react'
import { Copy, Check, Cake } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * Copia texto para a área de transferência usando a API nativa navigator.clipboard
 * com fallback para document.execCommand('copy') em navegadores restritivos ou iframes sem foco.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // Tentativa primária: navigator.clipboard
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback abaixo
    }
  }

  // Fallback: textarea invisível com execCommand
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.top = '0'
    textArea.style.left = '0'
    textArea.style.width = '2em'
    textArea.style.height = '2em'
    textArea.style.padding = '0'
    textArea.style.border = 'none'
    textArea.style.outline = 'none'
    textArea.style.boxShadow = 'none'
    textArea.style.background = 'transparent'
    textArea.setAttribute('readonly', '')
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(textArea)
    return successful
  } catch {
    return false
  }
}

/**
 * Normaliza e formata strings de data de nascimento para "DD/MM/AAAA".
 * Suporta "DD/MM/AAAA", "YYYY-MM-DD", ISO e variações comuns.
 */
export function formatBirthDateBR(raw?: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '—' || trimmed === '-') return null

  // Se já estiver no formato DD/MM/AAAA
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed
  }

  // Se for ISO ou YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch
    return `${d}/${m}/${y}`
  }

  // Se for DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    return `${d}/${m}/${y}`
  }

  return trimmed
}

interface PatientBirthDateBadgeProps {
  birthDate?: string | null
  className?: string
  showIcon?: boolean
  labelPrefix?: string
}

/**
 * Componente unificado para exibir data de aniversário do paciente
 * Clicável-para-copiar com troca temporária de ícone e toast "Copiado!"
 * Se birthDate for nulo/vazio, exibe "—" discretamente sem quebrar o layout.
 */
export function PatientBirthDateBadge({
  birthDate,
  className,
  showIcon = true,
  labelPrefix = 'Aniversário:',
}: PatientBirthDateBadgeProps) {
  const [copied, setCopied] = useState(false)
  const formatted = formatBirthDateBR(birthDate)

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!formatted) return

      const ok = await copyTextToClipboard(formatted)
      if (ok) {
        setCopied(true)
        toast({
          title: 'Copiado!',
          description: `Data de aniversário ${formatted} copiada para a área de transferência.`,
        })
        setTimeout(() => setCopied(false), 2000)
      } else {
        toast({
          title: 'Falha ao copiar',
          description: 'Não foi possível copiar para a área de transferência.',
          variant: 'destructive',
        })
      }
    },
    [formatted],
  )

  if (!formatted) {
    return (
      <span
        className={cn(
          'text-xs text-muted-foreground/60 inline-flex items-center gap-1.5',
          className,
        )}
      >
        {showIcon && <Cake className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
        <span>{labelPrefix}</span>
        <span className="font-mono">—</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Clique para copiar ${formatted}`}
      aria-label={`Copiar data de aniversário ${formatted}`}
      className={cn(
        'group inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
        'bg-pink-50 hover:bg-pink-100/90 text-pink-900 border border-pink-200/80',
        'dark:bg-pink-950/40 dark:text-pink-200 dark:border-pink-900/60',
        'transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-400/50',
        copied &&
          'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200',
        className,
      )}
    >
      {showIcon && (
        <Cake
          className={cn(
            'w-3.5 h-3.5 shrink-0 transition-colors',
            copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-pink-600 dark:text-pink-400',
          )}
        />
      )}
      <span>{labelPrefix}</span>
      <span className="font-semibold font-mono tracking-tight">{formatted}</span>
      <span className="ml-0.5 inline-flex items-center">
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-75 duration-150" />
        ) : (
          <Copy className="w-3 h-3 text-pink-700/70 group-hover:text-pink-900 dark:text-pink-300/70 dark:group-hover:text-pink-100 transition-colors" />
        )}
      </span>
      {copied && (
        <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold uppercase tracking-wider ml-0.5">
          Copiado!
        </span>
      )}
    </button>
  )
}
