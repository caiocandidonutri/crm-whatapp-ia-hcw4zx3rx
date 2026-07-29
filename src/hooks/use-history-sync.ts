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
      // silencioso — falha não deve quebrar UX
      console.warn('[history-sync] falha ao sincronizar conversa', id, err)
    })
  }, [
    conversation?.id,
    conversation?.instance_name,
    conversation?.remote_jid,
    conversation?.history_synced_at,
  ])
}
