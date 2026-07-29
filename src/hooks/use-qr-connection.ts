import { useState, useEffect, useCallback } from 'react'
import {
  criarInstancia,
  consultarStatusInstancia,
  desconectarInstancia,
} from '@/services/whatsapp_service'
import { useToast } from '@/hooks/use-toast'
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
    setIsGenerating(true)
    setPollErrors(0)
    try {
      const res = await criarInstancia(existingInstance?.instance_name)
      setInstanceName(res.instanceName)
      if (res.qrcodeBase64) {
        setQrCodeBase64(res.qrcodeBase64)
      }
    } catch (e: any) {
      setPollErrors((prev) => prev + 1)

      if (e?.status === 401) {
        pb.authStore.clear()
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
  }, [toast, existingInstance?.instance_name])

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
    let interval: any
    if (instanceName && pollErrors < 5) {
      interval = setInterval(async () => {
        try {
          const res = await consultarStatusInstancia(instanceName)
          if (res.state) {
            setRawState(res.state)
            if (res.state === 'connecting') {
              setConnectingSince((prev) => prev || Date.now())
            } else {
              setConnectingSince(null)
            }
          }
          if (res.status === 'connected') {
            clearInterval(interval)
            setQrCodeBase64(null)
            toast({
              title: 'WhatsApp conectado com sucesso!',
              className: 'bg-green-50 text-green-900 border-green-200',
            })
            if (onConnected) onConnected()
          } else if (res.status === 'qrcode' && res.qrcodeBase64) {
            setQrCodeBase64(res.qrcodeBase64)
            setPollErrors(0)
          }
        } catch (e) {
          setPollErrors((prev) => prev + 1)
        }
      }, 3000)
    }
    return () => clearInterval(interval)
  }, [instanceName, pollErrors, toast, onConnected])

  useEffect(() => {
    if (pollErrors === 5) {
      toast({
        title: 'Atenção',
        description: 'Estamos com instabilidade na conexão. Recarregue a página.',
        variant: 'destructive',
      })
    }
  }, [pollErrors, toast])

  return {
    instanceName,
    qrCodeBase64,
    isGenerating,
    pollErrors,
    rawState,
    connectingSince,
    generateQrCode,
    disconnect,
  }
}
