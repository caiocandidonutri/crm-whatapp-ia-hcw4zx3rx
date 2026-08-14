import { Wifi, Loader2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/hooks/use-realtime-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { RealtimeStatus } from '@/hooks/use-realtime-status'

const STATUS_CONFIG: Record<
  RealtimeStatus,
  { color: string; ring: string; label: string; Icon: typeof Wifi }
> = {
  connected: {
    color: 'text-emerald-500',
    ring: 'bg-emerald-500',
    label: 'Conectado em tempo real',
    Icon: Wifi,
  },
  connecting: {
    color: 'text-amber-500',
    ring: 'bg-amber-500',
    label: 'Conectando...',
    Icon: Loader2,
  },
  reconnecting: {
    color: 'text-amber-500',
    ring: 'bg-amber-500',
    label: 'Reconectando...',
    Icon: Loader2,
  },
  disconnected: {
    color: 'text-red-500',
    ring: 'bg-red-500',
    label: 'Desconectado',
    Icon: WifiOff,
  },
}

/**
 * Indicador sutil do status da conexão realtime (SSE do PocketBase),
 * exibido no canto do cabeçalho principal. Pequeno e não-poluir:
 * um ponto colorido + ícone, com tooltip explicativo no hover.
 */
export function RealtimeStatusIndicator() {
  const status = useRealtimeStatus()
  const cfg = STATUS_CONFIG[status]
  const { Icon } = cfg
  const isPending = status === 'connecting' || status === 'reconnecting'

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={cfg.label}
            className={cn(
              'relative flex items-center justify-center h-8 w-8 rounded-full',
              'text-muted-foreground hover:text-foreground transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Icon className={cn('h-3.5 w-3.5', cfg.color, isPending && 'animate-spin')} />
            {/* Ponto de status colorido no canto */}
            <span
              className={cn(
                'absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full',
                cfg.ring,
                status === 'connected' && 'animate-pulse',
              )}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          <p className="font-medium">{cfg.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
