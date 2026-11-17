import { useState, useEffect, useCallback } from 'react'
import {
  criarInstancia,
  consultarStatusInstancia,
  desconectarInstancia,
} from '@/services/whatsapp_service'
import { useToast } from '@/hooks/use-toast'
import { useCurrentAccount } from '@/hooks/use-current-account'
import pb from '@/lib/pocketbase/client'

interface ExistingInstanceLike {
  instance_name: string
  qrcode_base64?: string
  status?: string
}

export function useQrConnection(
  onConnected?: () => void,
  existingInstance?: ExistingInstanceLike | null,
) {
  const { toast } = useToast()
  const { accountId, loading: accountLoading } = useCurrentAccount()
  const [instanceName, setInstanceName] = useState<string | null>(
    existingInstance?.instance_name || null,
  )
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(
    existingInstance?.qrcode_base64 || null,
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [pollErrors, setPollErrors] = useState(0)
  const [rawState, setRawState] = useState<string | null>(null)
  const [connectingSince, setConnectingSince] = useState<number | null>(null)
  const [qrFetchedAt, setQrFetchedAt] = useState<number | null>(null)

  // Resetar contador de erros ao montar/reabrir página
  useEffect(() => {
    setPollErrors(0)
  }, [])

  useEffect(() => {
    if (existingInstance?.instance_name) {
      setInstanceName(existingInstance.instance_name)
      if (existingInstance.qrcode_base64) {
        setQrCodeBase64(existingInstance.qrcode_base64)
      } else {
        setQrCodeBase64(null)
      }
      if (existingInstance.status === 'connected') {
        setQrCodeBase64(null)
      }
      // QR herdado da instância existente pode ser velho (cache server-side de
      // até 55s + tempo desde então). Zera a marca para que, no 1º poll de
      // status, a idade do QR seja recalculada a partir do qr_updated_at que
      // o servidor agora devolve e expire em até 60s reais.
      setQrFetchedAt(existingInstance?.qrcode_base64 ? Date.now() - 30000 : null)
    }
  }, [existingInstance?.instance_name, existingInstance?.qrcode_base64, existingInstance?.status])

  const generateQrCode = useCallback(async () => {
    // Guard espelhando o backend (whatsapp_create.js): se a conta JÁ tem
    // instância connected, NUNCA chama a Evolution API nem cria registro —
    // protege o número 24h conectado.
    if (existingInstance?.status === 'connected') return
    if (accountLoading) {
      toast({
        title: 'Aguarde',
        description: 'Carregando informações da conta...',
      })
      return
    }
    if (!accountId) {
      toast({
        title: 'Conta não encontrada',
        description: 'Não foi possível identificar sua conta ativa. Tente recarregar a página.',
        variant: 'destructive',
      })
      return
    }
    setIsGenerating(true)
    setPollErrors(0)
    try {
      const res = await criarInstancia(existingInstance?.instance_name, accountId)
      setInstanceName(res.instanceName)
      if (res.qrcodeBase64) {
        setQrCodeBase64(res.qrcodeBase64)
        // QR novo acabou de nascer: reinicia a janela de 60s do timer.
        setQrFetchedAt(Date.now())
      }
    } catch (e: any) {
      // Tratar AbortError silenciosamente (não conta como erro)
      if (e?.name === 'AbortError' || e?.isAbort) {
        return
      }

      setPollErrors((prev) => prev + 1)

      // Se der 401 ao tentar gerar QR, só limpa authStore se de fato o token não for mais aceito pelo authRefresh
      if (e?.status === 401) {
        pb.collection('users')
          .authRefresh()
          .catch(() => {
            pb.authStore.clear()
          })
        return
      }

      toast({
        title: 'Atenção',
        description: 'Não foi possível gerar o QR Code. Verifique sua conexão e tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
    }
  }, [toast, existingInstance?.instance_name, existingInstance?.status, accountId, accountLoading])

  const disconnect = useCallback(async (name: string) => {
    try {
      await desconectarInstancia(name)
      setInstanceName(null)
      setQrCodeBase64(null)
      setRawState(null)
      setConnectingSince(null)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    let timeoutId: any
    let isCancelled = false

    // Polling do QR code com backoff crescente resiliente e auto-reset:
    // Nunca trava permanentemente após 5 tentativas.
    // Intervalo base de 5s, aumentando progressivamente até 15s em erros sucessivos.
    // A cada 5 erros consecutivos, reinicia contador para dar nova chance limpa.
    if (instanceName) {
      const poll = async () => {
        let nextDelay = 5000

        try {
          const res = await consultarStatusInstancia(instanceName)
          if (isCancelled) return

          if (res.error) {
            setPollErrors((prev) => {
              const next = prev + 1
              // Se acumulou 5 tentativas com erro, reinicia contador/retry suavemente
              if (next >= 5) {
                return 1
              }
              return next
            })
            // Backoff crescente: 5s, 7s, 9s, 12s, 15s
            nextDelay = Math.min(15000, 5000 + pollErrors * 2000)
          } else {
            // Sucesso na consulta: reseta contadores de erro
            setPollErrors(0)

            if (res.state) {
              setRawState(res.state)
              if (res.state === 'connecting') {
                setConnectingSince((prev) => prev || Date.now())
              } else {
                setConnectingSince(null)
              }
            }
            if (res.status === 'connected') {
              setQrCodeBase64(null)
              setQrFetchedAt(null)
              toast({
                title: 'WhatsApp conectado com sucesso!',
                className: 'bg-green-50 text-green-900 border-green-200',
              })
              if (onConnected) onConnected()
              return // encerra polling
            } else if (res.status === 'qrcode' && res.qrcodeBase64) {
              setQrCodeBase64(res.qrcodeBase64)
              // Marca quando ESTE QR chegou. QR do WhatsApp expira em ~60s:
              // passou disso, regenera via /instance/connect para não mostrar
              // QR morto (o usuário escaneava um QR que já não valia nada).
              const serverTs = res.qrUpdatedAt ? new Date(res.qrUpdatedAt).getTime() : 0
              const freshTs = serverTs > 0 ? serverTs : Date.now()
              setQrFetchedAt(freshTs)
            }
            nextDelay = 5500
          }
        } catch (e: any) {
          if (e?.name === 'AbortError' || e?.isAbort) {
            return
          }
          if (!isCancelled) {
            setPollErrors((prev) => {
              const next = prev + 1
              if (next >= 5) {
                return 1
              }
              return next
            })
            nextDelay = Math.min(15000, 5000 + pollErrors * 2000)
          }
        }

        if (!isCancelled) {
          timeoutId = setTimeout(poll, nextDelay)
        }
      }

      // Dispara primeiro ciclo
      timeoutId = setTimeout(poll, 1500)
    }

    return () => {
      isCancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [instanceName, pollErrors, toast, onConnected])

  // Timer de 60s: força gerar um QR novo quando o atual já expirou.
  useEffect(() => {
    if (!instanceName || !qrCodeBase64) return
    if (qrFetchedAt === null) return
    const elapsed = Date.now() - qrFetchedAt
    const remaining = Math.max(500, 60000 - elapsed)
    const timer = setTimeout(() => {
      setQrFetchedAt(null)
      generateQrCode()
    }, remaining)
    return () => clearTimeout(timer)
  }, [instanceName, qrCodeBase64, qrFetchedAt, generateQrCode])

  const resetErrors = useCallback(() => {
    setPollErrors(0)
  }, [])

  return {
    instanceName,
    qrCodeBase64,
    isGenerating,
    pollErrors,
    rawState,
    connectingSince,
    generateQrCode,
    resetErrors,
    disconnect,
  }
}
