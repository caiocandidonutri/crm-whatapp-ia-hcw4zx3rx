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

  // Resetar contador de erros ao montar/reabrir página
  useEffect(() => {
    setPollErrors(0)
  }, [])

  useEffect(() => {
    if (existingInstance?.instance_name) {
      setInstanceName(existingInstance.instance_name)
      if (existingInstance.qrcode_base64) {
        setQrCodeBase64(existingInstance.qrcode_base64)
      }
      if (existingInstance.status === 'connected') {
        setQrCodeBase64(null)
      }
    }
  }, [existingInstance?.instance_name, existingInstance?.qrcode_base64, existingInstance?.status])

  const generateQrCode = useCallback(async () => {
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
  }, [toast, existingInstance?.instance_name, accountId, accountLoading])

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
              toast({
                title: 'WhatsApp conectado com sucesso!',
                className: 'bg-green-50 text-green-900 border-green-200',
              })
              if (onConnected) onConnected()
              return // encerra polling
            } else if (res.status === 'qrcode' && res.qrcodeBase64) {
              setQrCodeBase64(res.qrcodeBase64)
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
