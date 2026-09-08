import { Wifi, Loader2, WifiOff, MessageCircleOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useRealtimeStatus } from '@/hooks/use-realtime-status'
import { useInstanciaAtiva } from '@/hooks/use-whatsapp'
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
 * Indicador sutil do status da conexão realtime (SSE do PocketBase)
 * e do status da instância WhatsApp quando desconectada,
 * exibido no canto do cabeçalho principal.
 */
export function RealtimeStatusIndicator() {
  const navigate = useNavigate()
  const status = useRealtimeStatus()
  const { instance, loading: loadingInstance } = useInstanciaAtiva()
  const cfg = STATUS_CONFIG[status]
  const { Icon } = cfg
  const isPending = status === 'connecting' || status === 'reconnecting'

  const isWaDisconnected = !loadingInstance && instance?.status === 'disconnected'

  return (
    <div className="flex items-center gap-1">
      {isWaDisconnected && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => navigate('/conversas')}
                aria-label="WhatsApp desconectado — clique para reconectar"
                className={cn(
                  'relative flex items-center justify-center h-8 px-2 rounded-full',
                  'bg-red-50 text-red-600 hover:bg-red-100 transition-colors border border-red-200/80',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring gap-1.5',
                )}
              >
                <MessageCircleOff className="h-3.5 w-3.5 text-red-600 animate-pulse" />
                <span className="text-[11px] font-semibold text-red-700 hidden lg:inline">
                  WhatsApp Desconectado
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p className="font-medium text-xs">WhatsApp desconectado — clique para reconectar</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

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
    </div>
  )
}
