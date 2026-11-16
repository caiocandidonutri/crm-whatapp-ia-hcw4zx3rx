import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import pb from '@/lib/pocketbase/client'
import { isNetworkError } from '@/lib/pocketbase/errors'
import { consultarStatusInstancia } from '@/services/whatsapp_service'

/** Limiar padrão: alerta quando nenhuma instância está connected há mais de 5 min. */
export const DEFAULT_DISCONNECT_THRESHOLD_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 30 * 1000
const REAPPEAR_DELAY_MS = 3 * 60 * 1000

interface DisconnectAlertBannerProps {
  /** ms sem nenhuma instância connected antes de mostrar o alerta (default 5 min) */
  thresholdMs?: number
}

function safeTimestampMs(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return isFinite(value) && value > 0 ? value : 0
  const t = new Date(String(value)).getTime()
  return isFinite(t) ? t : 0
}

/**
 * Banner de desconexão para a Home (Index.tsx).
 * Mostra o alerta 'WhatsApp desconectado' quando NENHUMA instância da conta
 * está status='connected' há mais de `thresholdMs` (default: 5 min).
 * Defensivo por construção: valores nulos/malformados recebem fallback, nunca
 * exceção (padrão das rodadas anteriores contra o ErrorBoundary).
 */
export function DisconnectAlertBanner({
  thresholdMs = DEFAULT_DISCONNECT_THRESHOLD_MS,
}: DisconnectAlertBannerProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { accountId, loading: accountLoading } = useCurrentAccount()
  const [dismissed, setDismissed] = useState(false)
  const [reappearTimer, setReappearTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [tick, setTick] = useState(0)
  const [connectedUpdatedAt, setConnectedUpdatedAt] = useState<string | null>(null)
  const [hasInstance, setHasInstance] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const toastShownRef = useRef(false)

  // Reavalia o threshold periodicamente (sem isso, o banner só mudaria no reload)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => (t + 1) % 1000000), 30 * 1000)
    return () => clearInterval(interval)
  }, [])

  const fetchInstances = useCallback(async () => {
    if (!user || accountLoading || !accountId) {
      setLoaded(true)
      return
    }
    try {
      const records = await pb.collection('whatsapp_instances').getFullList({
        batch: 200,
        filter: `account_id = "${accountId}"`,
        sort: '-created',
        requestKey: null,
      })
      const safe: Array<{ status?: string; updated?: string; instance_name?: string }> =
        Array.isArray(records) ? records : []
      const connected = safe.find((r) => r && r.status === 'connected')
      setHasInstance(safe.length > 0)
      if (connected) {
        setConnectedUpdatedAt(connected.updated || new Date().toISOString())
      } else {
        // Nenhuma connected: usa o updated mais recente de qualquer instância —
        // se houve uma connected que caiu, o alerta nasce 5 min após a queda.
        const maxUpdated = safe.reduce<string | null>((max, r) => {
          const u = r?.updated || ''
          if (!u) return max
          if (!max || safeTimestampMs(u) > safeTimestampMs(max)) return u
          return max
        }, null)
        setConnectedUpdatedAt(maxUpdated)
      }
    } catch (e) {
      if (isNetworkError(e)) return // transitória: tenta de novo no próximo ciclo
      console.warn('[DisconnectAlertBanner] Falha ao carregar instâncias:', e)
      setHasInstance(false)
      setConnectedUpdatedAt(null)
    } finally {
      setLoaded(true)
    }
  }, [user, accountId, accountLoading])

  useEffect(() => {
    fetchInstances()
    const interval = setInterval(fetchInstances, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchInstances])

  const shouldShow = useMemo(() => {
    if (!loaded || accountLoading || dismissed || !hasInstance) return false
    if (safeTimestampMs(connectedUpdatedAt) <= 0) return false
    if (!connectedUpdatedAt) return false
    // Idade desde a última vez que ALGUMA instância esteve connected:
    // - se hoje há uma connected, `connectedUpdatedAt` é o updated dela (sempre recente, PB atualiza o autodate a cada save de status)
    // - se nenhuma está connected, é o updated da última que esteve — passou do limiar, alerta
    const age = Date.now() - safeTimestampMs(connectedUpdatedAt)
    return age > thresholdMs
  }, [loaded, accountLoading, dismissed, hasInstance, connectedUpdatedAt, thresholdMs, tick])

  // Toast uma única vez quando o alerta nasce
  useEffect(() => {
    if (shouldShow && !toastShownRef.current) {
      toastShownRef.current = true
      toast.error('WhatsApp desconectado', {
        description: 'Reconecte para continuar recebendo mensagens.',
        duration: 8000,
      })
    }
    if (!shouldShow && toastShownRef.current) {
      toastShownRef.current = false
    }
  }, [shouldShow])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    if (reappearTimer) clearTimeout(reappearTimer)
    const timer = setTimeout(() => setDismissed(false), REAPPEAR_DELAY_MS)
    setReappearTimer(timer)
  }, [reappearTimer])

  useEffect(() => {
    return () => {
      if (reappearTimer) clearTimeout(reappearTimer)
    }
  }, [reappearTimer])

  if (!shouldShow) return null

  return (
    <div className="fixed top-20 inset-x-0 z-40 px-4 flex justify-center animate-fade-in-down">
      <div className="w-full max-w-3xl flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="p-1.5 bg-red-100 rounded-lg shrink-0">
            <WifiOff className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-sm font-medium text-red-900 truncate">
            WhatsApp desconectado — reconecte para continuar recebendo mensagens
          </p>
        </div>
        <Button
          size="sm"
          className="bg-red-600 hover:bg-red-700 text-white shrink-0 h-8"
          onClick={() => navigate('/conversas')}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Reconectar
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 shrink-0 text-red-600 hover:bg-red-100')}
          onClick={handleDismiss}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
