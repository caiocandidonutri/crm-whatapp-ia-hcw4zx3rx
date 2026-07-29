import { Conversation, WhatsappMessage } from '@/types/models'
import pb from '@/lib/pocketbase/client'

/**
 * Detecta valores inválidos pra nome de contato. Casos:
 *   - vazio/whitespace
 *   - só dígitos com comprimento ≥10 (provavelmente é o número, não nome
 *     real — bug histórico onde contact_name foi populado com o phone)
 *   - "Você", "Eu", "You", "Me" e variantes (bug do webhook antigo
 *     setando pushName como contact_name pra msgs fromMe)
 *
 * Centralizada aqui pra ser usada em mappers, CRM list e CRM detail —
 * sempre que um contact_name for exibido, passa por isso.
 */
export function isInvalidContactName(name?: string | null): boolean {
  if (!name) return true
  const trimmed = String(name).trim()
  if (!trimmed) return true
  if (/^\d{10,}$/.test(trimmed)) return true
  const lower = trimmed.toLowerCase()
  if (['você', 'voce', 'eu', 'you', 'me', 'i'].includes(lower)) return true
  return false
}

/**
 * Resolve o nome de exibição final pra um contato/conversa: usa
 * contact_name se for um nome válido (não inválido pelo `isInvalidContactName`),
 * senão deriva do remote_jid via `jidToDisplayName`.
 */
export function getDisplayName(
  contactName: string | undefined | null,
  remoteJid: string | undefined,
): string {
  if (!isInvalidContactName(contactName)) return (contactName as string).trim()
  return jidToDisplayName(remoteJid)
}

/**
 * Quando contact_name está vazio, deriva um display name a partir do
 * remote_jid. Formata número BR conhecido (+55 com 12-13 dígitos), faz
 * fallback simples "+<dígitos>" pra outros, e devolve "Contato WhatsApp"
 * pra formatos não-numéricos (LID novo do Baileys, JIDs corrompidos).
 *
 * Histórico: antes o fallback usava `contact_phone`, mas esse campo era
 * populado em algumas convs antigas com o número CRU sem formatação
 * (ex.: "208439242412160"), o que dava aparência ruim na lista. Agora
 * derivamos do remote_jid e aplicamos formatação consistente.
 *
 * Exportada pra ser usada em outros lugares (ex.: nome do remetente em
 * mensagens de grupo no ChatArea).
 */
export function jidToDisplayName(jid?: string): string {
  if (!jid) return 'Contato WhatsApp'
  if (jid.endsWith('@g.us')) return 'Grupo WhatsApp'
  // @lid (Long ID novo do Baileys) é um identificador opaco, não número.
  if (jid.endsWith('@lid')) return 'Contato WhatsApp'
  const numberPart = jid.split('@')[0]
  if (!numberPart || !/^\d+$/.test(numberPart)) return 'Contato WhatsApp'
  if (numberPart.startsWith('55') && numberPart.length >= 12 && numberPart.length <= 13) {
    const ddd = numberPart.slice(2, 4)
    const rest = numberPart.slice(4)
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
  }
  return '+' + numberPart
}

export function conversationsToChats(conversations: Conversation[]) {
  return conversations.map((c) => {
    let lastMsgText = c.last_message || ''
    if (lastMsgText === '[image]') lastMsgText = 'Foto'
    else if (lastMsgText === '[video]') lastMsgText = 'Vídeo'
    else if (lastMsgText === '[audio]') lastMsgText = 'Áudio'
    else if (lastMsgText === '[document]') lastMsgText = 'Documento'
    else if (lastMsgText === '[sticker]') lastMsgText = 'Figurinha'
    else if (lastMsgText === '[mensagem não suportada]') lastMsgText = 'Mensagem não suportada'

    // Preferir o timestamp REAL da última mensagem (em segundos, vindo do
    // Baileys). Se não tiver, deixa undefined — o ChatList já trata vazio
    // corretamente (não exibe horário). Antes caía pra `updated` (upload
    // time), o que mascarava convs sem timestamp real e bagunçava a ordem.
    const realTs =
      c.last_message_timestamp && c.last_message_timestamp > 0
        ? new Date(c.last_message_timestamp * 1000).toISOString()
        : undefined

    return {
      id: c.id,
      type: c.type || 'individual',
      // Pula contact_phone como fallback: ele às vezes guarda só o número
      // cru sem formatação (ex.: "208439242412160" aparecia na lista).
      // Usa getDisplayName que também invalida contact_name "lixo" (só
      // dígitos longos, ou "Você"/"Eu") antes de cair pro JID formatado.
      name: getDisplayName(c.contact_name, c.remote_jid),
      phone: c.contact_phone || '',
      unread: c.unread_count || 0,
      avatar: c.avatar_url || '',
      instance_name: c.instance_name,
      remote_jid: c.remote_jid,
      archived: c.archived === true,
      messages: [],
      ai_agent_id: c.ai_agent_id || null,
      ai_enabled: !!c.ai_enabled,
      category_ids: c.category_ids || [],
      ...(c.is_group ? { groupDetails: { participants: c.group_size || 0, colors: {} } } : {}),
      ...(c.last_message
        ? {
            lastMessage: {
              text: lastMsgText,
              timestamp: realTs,
            },
          }
        : {}),
    }
  })
}

export function whatsappMessagesToMessages(messages: WhatsappMessage[]) {
  return messages.map((m) => {
    const typeStr = m.message_type || ''
    const isMedia = [
      'imageMessage',
      'videoMessage',
      'audioMessage',
      'documentMessage',
      'stickerMessage',
      'image',
      'video',
      'audio',
      'document',
      'sticker',
    ].includes(typeStr)

    let mediaType = typeStr
    if (mediaType.endsWith('Message')) {
      mediaType = mediaType.replace('Message', '')
    }

    const mediaUrl =
      m.media_url ||
      (m.media_file ? `${pb.baseUrl}/api/files/whatsapp_messages/${m.id}/${m.media_file}` : '')

    let linkPreview = undefined
    if (m.link_url) {
      linkPreview = {
        url: m.link_url,
        title: m.link_title || '',
        description: m.link_description || '',
        thumbnailB64: m.link_thumbnail_b64 || '',
      }
    }

    let parsedReactions = []
    if (m.reactions) {
      try {
        parsedReactions = typeof m.reactions === 'string' ? JSON.parse(m.reactions) : m.reactions
      } catch {
        /* intentionally ignored */
      }
    }

    return {
      id: m.id,
      senderId: m.from_me ? 'me' : m.participant_jid || m.remote_jid,
      pushName: m.participant_pushname || m.push_name,
      text: m.content || '',
      status: m.status,
      timestamp: m.timestamp
        ? new Date(m.timestamp * 1000).toISOString()
        : m.created
          ? new Date(m.created).toISOString()
          : new Date().toISOString(),
      isRead: m.status === 'read' || m.status === 'played',
      linkPreview,
      reactions: parsedReactions,
      ...(isMedia && mediaType
        ? {
            media: {
              type: mediaType as any,
              url: mediaUrl,
              name: m.media_filename || m.media_file || '',
              mimetype: m.media_mimetype || '',
            },
          }
        : {}),
    }
  })
}
