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
    <div className="w-full bg-amber-500 text-amber-950 border-b border-amber-600/30 px-4 py-2.5 transition-all animate-fade-in shadow-sm">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2.5 text-center sm:text-left">
          <div className="p-1 bg-amber-600/20 rounded-full shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-950" />
          </div>
          <span className="font-medium">
            Mensagens automáticas pausadas — nada é enviado aos pacientes até você ativar.
          </span>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => toggle()}
          disabled={toggling}
          className="bg-amber-950 hover:bg-black text-amber-100 border-none shrink-0 font-semibold h-8 px-4 rounded-lg shadow-sm"
        >
          {toggling ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Ativando...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5 fill-current" />
              Ativar agora
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}
