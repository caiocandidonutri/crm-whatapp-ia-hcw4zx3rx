import React from 'react'
import { AlertTriangle, Play, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAutomationsStatus } from '@/hooks/use-automations-status'

export function AutomationsPausedBanner() {
  const { paused, loading, toggling, toggle } = useAutomationsStatus()

  // Se estiver carregando inicialmente ou se estiver ativo (não pausado), esconder o banner
  if (loading || !paused) {
    return null
  }

  return (
    <div className="w-full bg-slate-50 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground transition-all">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="font-medium text-foreground/80">
            Automações pausadas — nenhum disparo ativo no momento.
          </span>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => toggle()}
          disabled={toggling}
          className="h-7 text-xs px-2.5 text-muted-foreground hover:text-foreground shrink-0"
        >
          {toggling ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Atualizando...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Play className="w-3 h-3 fill-current text-emerald-600" />
              Revisar / Ativar
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}
