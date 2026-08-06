import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff, RefreshCw, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useInstanciaAtiva } from '@/hooks/use-whatsapp'
import { toast } from 'sonner'
import { consultarStatusInstancia } from '@/services/whatsapp_service'

const REAPPEAR_DELAY_MS = 3 * 60 * 1000
const STATUS_CHECK_INTERVAL_MS = 30 * 1000

export function DisconnectBanner() {
  const navigate = useNavigate()
  const { instance, loading, reload } = useInstanciaAtiva()
  const [dismissed, setDismissed] = useState(false)
  const [reappearTimer, setReappearTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [statusCheckFailed, setStatusCheckFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const prevStatusRef = useRef<string | undefined>(undefined)
  const toastShownRef = useRef(false)

  const instanceStatus = instance?.status
  const isDisconnected = !loading && instanceStatus === 'disconnected'
  const isUnknown = !loading && (statusCheckFailed || (!instance && !loading))

  const clearReappearTimer = useCallback(() => {
    if (reappearTimer) {
      clearTimeout(reappearTimer)
      setReappearTimer(null)
    }
  }, [reappearTimer])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    clearReappearTimer()
    const timer = setTimeout(() => {
      setDismissed(false)
    }, REAPPEAR_DELAY_MS)
    setReappearTimer(timer)
  }, [clearReappearTimer])

  const handleReconnect = useCallback(() => {
    navigate('/conversas')
  }, [navigate])

  const handleRetry = useCallback(async () => {
    if (!instance?.instance_name) {
      reload()
      return
    }
    setRetrying(true)
    try {
      const res = await consultarStatusInstancia(instance.instance_name)
      if (res.error) {
        setStatusCheckFailed(true)
      } else {
        setStatusCheckFailed(false)
        reload()
      }
    } catch {
      setStatusCheckFailed(true)
    } finally {
      setRetrying(false)
    }
  }, [instance?.instance_name, reload])

  useEffect(() => {
    if (loading) return

    if (prevStatusRef.current === undefined) {
      prevStatusRef.current = instanceStatus
      if (isDisconnected) {
        toastShownRef.current = true
      }
      return
    }

    if (instanceStatus !== prevStatusRef.current) {
      if (instanceStatus === 'disconnected' && !toastShownRef.current) {
        toastShownRef.current = true
        toast.error('WhatsApp desconectado', {
          description: 'Reconecte para continuar recebendo mensagens.',
          action: {
            label: 'Reconectar',
            onClick: () => navigate('/conversas'),
          },
          duration: 8000,
        })
      }
      if (instanceStatus === 'connected') {
        toastShownRef.current = false
        setDismissed(false)
        setStatusCheckFailed(false)
        clearReappearTimer()
        toast.success('WhatsApp reconectado!', {
          description: 'Você voltou a receber mensagens.',
          duration: 4000,
        })
      }
      prevStatusRef.current = instanceStatus
    }
  }, [instanceStatus, loading, isDisconnected, navigate, clearReappearTimer])

  useEffect(() => {
    if (!instance?.instance_name || instance?.status === 'connected') {
      setStatusCheckFailed(false)
      return
    }

    const checkStatus = async () => {
      try {
        const res = await consultarStatusInstancia(instance.instance_name)
        if (res.error) {
          setStatusCheckFailed(true)
        } else if (res.status === 'connected') {
          setStatusCheckFailed(false)
          reload()
        } else {
          setStatusCheckFailed(false)
        }
      } catch {
        setStatusCheckFailed(true)
      }
    }

    checkStatus()
    const interval = setInterval(checkStatus, STATUS_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [instance?.instance_name, instance?.status, reload])

  useEffect(() => {
    return () => {
      if (reappearTimer) clearTimeout(reappearTimer)
    }
  }, [reappearTimer])

  if (loading) return null

  if (isDisconnected && !dismissed) {
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
            onClick={handleReconnect}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reconectar
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-100"
            onClick={handleDismiss}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (isUnknown && !dismissed) {
    return (
      <div className="fixed top-20 inset-x-0 z-40 px-4 flex justify-center animate-fade-in-down">
        <div className="w-full max-w-3xl flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="p-1.5 bg-amber-100 rounded-lg shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-sm font-medium text-amber-900 truncate">
              Status da conexão indisponível — não foi possível verificar o WhatsApp.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0 h-8"
            onClick={handleRetry}
            disabled={retrying}
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', retrying && 'animate-spin')} />
            Tentar novamente
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-amber-600 hover:bg-amber-100"
            onClick={handleDismiss}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    )
  }

  return null
}
