import React, { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, X, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { WhatsappInstance } from '@/types/models'
import { toast } from 'sonner'

interface ImportProgressBannerProps {
  instance: WhatsappInstance | null | undefined
}

/**
 * Banner discreto que aparece no topo da página de Conversas enquanto a
 * importação de histórico está em andamento. Mostra contagem ao vivo de
 * mensagens recebidas. Some sozinho quando o backend marca
 * is_importing_history=false (via isLatest do Baileys ou cron de timeout).
 *
 * Quando termina, exibe um toast de sucesso uma única vez.
 */
export function ImportProgressBanner({ instance }: ImportProgressBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const wasImportingRef = useRef(false)
  const lastInstanceIdRef = useRef<string | null>(null)
  const completedToastRef = useRef<Set<string>>(new Set())

  const importing = instance?.is_importing_history === true
  const count = instance?.import_messages_count || 0
  const period = instance?.sync_period_days
  const periodLabel =
    period === 0
      ? 'todo o histórico'
      : period === 1
        ? 'as últimas 24 horas'
        : period && period > 0
          ? `os últimos ${period} dias`
          : 'o histórico'

  // Reset dismissed quando a instância muda ou um novo import começa
  useEffect(() => {
    if (!instance) return
    if (lastInstanceIdRef.current !== instance.id) {
      lastInstanceIdRef.current = instance.id
      setDismissed(false)
    }
    if (importing && !wasImportingRef.current) {
      // novo import começou
      setDismissed(false)
    }
  }, [instance, importing])

  // Toast de conclusão (uma vez por ciclo de import)
  useEffect(() => {
    if (!instance) return
    const cycleKey = instance.id + ':' + (instance.import_started_at || '')
    if (
      wasImportingRef.current &&
      !importing &&
      count > 0 &&
      !completedToastRef.current.has(cycleKey)
    ) {
      completedToastRef.current.add(cycleKey)
      toast.success('Histórico importado!', {
        description: `${count.toLocaleString('pt-BR')} mensagens recebidas do WhatsApp.`,
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
        duration: 6000,
      })
    }
    wasImportingRef.current = importing
  }, [importing, count, instance])

  if (!instance || !importing || dismissed) return null

  return (
    <div
      className={cn(
        'shrink-0 mx-4 mt-3 mb-1 rounded-xl border border-blue-200 bg-blue-50/80 backdrop-blur-sm',
        'shadow-sm overflow-hidden animate-fade-in',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
            <Download className="w-4 h-4 text-blue-700" />
          </div>
          <Loader2 className="absolute -top-0.5 -right-0.5 w-4 h-4 animate-spin text-blue-600 bg-white rounded-full p-0.5 border border-blue-200" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-900">
            Importando {periodLabel} em segundo plano
          </p>
          <p className="text-xs text-blue-700/80 mt-0.5">
            {count > 0 ? (
              <>
                <span className="font-semibold">{count.toLocaleString('pt-BR')}</span> mensagens
                recebidas.{' '}
                <span className="opacity-80">
                  Pode usar normalmente — a lista atualiza sozinha quando termina.
                </span>
              </>
            ) : (
              'Aguardando o WhatsApp do seu celular começar o envio. Pode usar normalmente.'
            )}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-blue-700/70 hover:text-blue-900 hover:bg-blue-100/60 rounded-full"
          onClick={() => setDismissed(true)}
          aria-label="Ocultar aviso de importação"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* barra animada infinita (não temos % real) */}
      <div className="h-1 bg-blue-100 overflow-hidden">
        <div className="h-full bg-blue-500 w-1/3 animate-import-slide" />
      </div>
    </div>
  )
}
