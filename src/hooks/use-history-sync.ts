import { useEffect, useRef } from 'react'
import { sincronizarConversa } from '@/services/whatsapp_service'
import { Conversation } from '@/types/models'

/**
 * Dispara sync de histórico (50 últimas msgs) quando o usuário abre uma conversa
 * pela primeira vez. Idempotente: só dispara uma vez por sessão por conversa,
 * e só se a conversa nunca foi sincronizada antes.
 */
export function useHistorySync(conversation: Conversation | null | undefined) {
  const triedRef = useRef<Set<string>>(new Set())
  const lastCatchupRef = useRef<{ [jid: string]: number }>({})

  // 1. Sync inicial quando nunca sincronizou
  useEffect(() => {
    if (!conversation) return
    const id = conversation.id
    const instanceName = conversation.instance_name
    const remoteJid = conversation.remote_jid
    const synced = conversation.history_synced_at

    if (!id || !instanceName || !remoteJid) return
    if (synced) return // já sincronizou em sessão anterior
    if (triedRef.current.has(id)) return // já tentou nesta sessão

    triedRef.current.add(id)
    sincronizarConversa(instanceName, remoteJid).catch((err) => {
      console.warn('[history-sync] falha ao sincronizar conversa', id, err)
    })
  }, [
    conversation?.id,
    conversation?.instance_name,
    conversation?.remote_jid,
    conversation?.history_synced_at,
  ])

  // 2. Catch-up incremental (sinceTs) ao selecionar a conversa e ao retornar o foco (visibilitychange)
  useEffect(() => {
    if (!conversation) return
    const instanceName = conversation.instance_name
    const remoteJid = conversation.remote_jid
    const lastTs = conversation.last_message_timestamp || 0

    if (!instanceName || !remoteJid || lastTs <= 0) return

    const doCatchup = () => {
      const now = Date.now()
      const prevCatchup = lastCatchupRef.current[remoteJid] || 0
      // Evita disparar múltiplos catch-ups seguidos em menos de 10 segundos
      if (now - prevCatchup < 10000) return
      lastCatchupRef.current[remoteJid] = now

      sincronizarConversa(instanceName, remoteJid, undefined, lastTs).catch((err) => {
        console.warn('[history-sync] falha no catch-up incremental', remoteJid, err)
      })
    }

    // Executa ao selecionar a conversa
    doCatchup()

    // Executa ao voltar para a aba
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        doCatchup()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [
    conversation?.id,
    conversation?.instance_name,
    conversation?.remote_jid,
    conversation?.last_message_timestamp,
  ])
}
