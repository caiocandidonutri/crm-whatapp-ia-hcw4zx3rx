import { memo } from 'react'
import {
  BarChart3,
  MapPin,
  User,
  ThumbsUp,
  Clock,
  ShieldAlert,
  Paperclip,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Mapa de tipos de mensagem do WhatsApp que não têm renderização rica
 * (não são imagem/vídeo/áudio/documento/sticker/texto) para um label
 * amigável em PT-BR + ícone.
 *
 * Para adicionar um novo tipo no futuro, basta inserir uma entrada aqui.
 * O componente usa `label` como texto principal e `hint` (opcional) como
 * subtítulo explicativo.
 */
const UNSUPPORTED_MESSAGE_TYPES: Record<
  string,
  { label: string; hint?: string; icon: LucideIcon }
> = {
  pollMessage: {
    label: 'Enquete',
    hint: 'Enquete enviada pelo WhatsApp',
    icon: BarChart3,
  },
  locationMessage: {
    label: 'Localização compartilhada',
    icon: MapPin,
  },
  contactMessage: {
    label: 'Contato compartilhado',
    icon: User,
  },
  contactsMessage: {
    label: 'Contatos compartilhados',
    icon: User,
  },
  reactionMessage: {
    label: 'Reação',
    icon: ThumbsUp,
  },
  ephemeralMessage: {
    label: 'Mensagem temporária',
    hint: 'A mensagem foi configurada para desaparecer',
    icon: Clock,
  },
  protocolMessage: {
    label: 'Mensagem do sistema',
    hint: 'Notificação interna do WhatsApp',
    icon: ShieldAlert,
  },
}

const DEFAULT_META: { label: string; hint?: string; icon: LucideIcon } = {
  label: 'Mensagem não suportada',
  hint: undefined,
  icon: Paperclip,
}

/**
 * Verifica se um `message_type` (raw do PocketBase / webhook) corresponde
 * a um tipo "não suportado" que deve ser renderizado como card amigável.
 * Retorna `true` para qualquer tipo que NÃO seja texto/mídia suportada.
 */
const SUPPORTED_TYPES = new Set([
  'conversation',
  'extendedTextMessage',
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
  '',
])

export function isUnsupportedMessageType(type: string | undefined | null): boolean {
  if (!type) return false
  return !SUPPORTED_TYPES.has(type)
}

interface UnsupportedMessageCardProps {
  /** message_type cru do PocketBase (ex.: "pollMessage", "locationMessage"). */
  type: string
  isMe: boolean
  /** Texto de conteúdo (caption) adicional, se houver. */
  caption?: string
}

/**
 * Card visual reutilizável para tipos de mensagem do WhatsApp que não são
 * texto/imagem/vídeo/áudio/documento/sticker. Mostra um ícone + label
 * amigável em PT-BR, com fundo adaptável para balões enviados/recebidos.
 *
 * Extensível: para suportar um novo tipo, adicione uma entrada em
 * `UNSUPPORTED_MESSAGE_TYPES` acima.
 */
function UnsupportedMessageCardBase({ type, isMe, caption }: UnsupportedMessageCardProps) {
  const meta = UNSUPPORTED_MESSAGE_TYPES[type] || DEFAULT_META
  const Icon = meta.icon

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg my-0.5 max-w-[260px]',
        isMe ? 'bg-black/10 text-white/90' : 'bg-black/5 text-foreground',
      )}
    >
      <div
        className={cn(
          'shrink-0 flex items-center justify-center w-9 h-9 rounded-full',
          isMe ? 'bg-white/20' : 'bg-primary/10',
        )}
      >
        <Icon className={cn('w-4.5 h-4.5', isMe ? 'text-white' : 'text-primary')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">{meta.label}</p>
        {meta.hint && (
          <p
            className={cn(
              'text-[11px] leading-tight truncate mt-0.5',
              isMe ? 'text-white/60' : 'text-muted-foreground',
            )}
          >
            {meta.hint}
          </p>
        )}
        {caption && caption.trim() && (
          <p
            className={cn(
              'text-[11px] leading-tight truncate mt-0.5 italic',
              isMe ? 'text-white/60' : 'text-muted-foreground',
            )}
          >
            {caption.trim()}
          </p>
        )}
      </div>
    </div>
  )
}

export const UnsupportedMessageCard = memo(UnsupportedMessageCardBase)
