import { FileText, FileDown, Eye, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLazyMedia } from '@/hooks/use-lazy-media'

type SelectedMedia = { url: string; type: string; mimetype?: string; name?: string }

interface MessageMediaProps {
  media: { type: string; url: string; name?: string; mimetype?: string } | undefined
  isMe: boolean
  status?: string
  onSelectMedia: (media: SelectedMedia) => void
}

/**
 * Renderiza o card de mídia de uma mensagem de WhatsApp.
 *
 * Carregamento lazy + throttle:
 *  - A mídia só começa a baixar quando o card entra na viewport (ou a 300px
 *    dela) via IntersectionObserver (`useLazyMedia`).
 *  - O download passa por uma fila global (`media-throttle`) que limita a 3
 *    simultâneas com 200ms entre cada — evita o erro 429 do PocketBase que
 *    acontecia quando a conversa tinha muitas mídias e o navegador baixava
 *    todas de uma vez.
 *  - Enquanto carrega: skeleton/placeholder animado (em vez de "Mídia
 *    indisponível"). Se falhar, mostra o aviso de erro.
 *
 * Para documentos PDF, o botão de preview e o de download usam a object URL
 * (blob:) retornada pelo cache de mídia — assim o header Authorization é
 * aplicado no fetch e não quebra em domínios cruzados.
 */
export function MessageMedia({ media, isMe, status, onSelectMedia }: MessageMediaProps) {
  if (status === 'media_failed') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 p-2 rounded-lg mb-1',
          isMe ? 'bg-black/10 text-white/80' : 'bg-black/5 text-muted-foreground',
        )}
      >
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm italic">Mídia indisponível</span>
      </div>
    )
  }
  if (!media || !media.url) return null
  const { type, url, name, mimetype } = media

  if (type === 'image')
    return (
      <ImageMedia
        url={url}
        isMe={isMe}
        onSelectMedia={() => onSelectMedia({ url, type, mimetype, name })}
      />
    )

  if (type === 'video') return <VideoMedia url={url} />

  if (type === 'audio') return <AudioMedia url={url} />

  if (type === 'document')
    return (
      <DocumentMedia
        url={url}
        name={name}
        mimetype={mimetype}
        isMe={isMe}
        onSelectMedia={() => onSelectMedia({ url, type, mimetype, name })}
      />
    )

  if (type === 'sticker') return <StickerMedia url={url} />

  return null
}

/** Placeholder/skeleton comum usado enquanto a mídia carrega. */
function LoadingBox({ className }: { className?: string }) {
  return <Skeleton className={cn('mb-1 rounded-lg animate-pulse', className)} />
}

function ImageMedia({
  url,
  isMe,
  onSelectMedia,
}: {
  url: string
  isMe: boolean
  onSelectMedia: () => void
}) {
  const { ref, state } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1">
      {state.status === 'idle' || state.status === 'loading' ? (
        <LoadingBox className="w-[240px] h-[180px] max-w-full" />
      ) : state.status === 'error' ? (
        <MediaError isMe={isMe} />
      ) : (
        <img
          src={state.url}
          alt="attachment"
          loading="lazy"
          className="rounded-lg max-w-full w-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onSelectMedia()
          }}
        />
      )}
    </div>
  )
}

function VideoMedia({ url }: { url: string }) {
  const { ref, state } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1">
      {state.status === 'idle' || state.status === 'loading' ? (
        <LoadingBox className="w-[240px] h-[180px] max-w-full" />
      ) : state.status === 'error' ? (
        <MediaError />
      ) : (
        <video
          src={state.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg max-w-full w-auto max-h-[300px] object-cover cursor-pointer"
        />
      )}
    </div>
  )
}

function AudioMedia({ url }: { url: string }) {
  const { ref, state } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1 rounded-xl min-w-[200px] w-full flex items-center">
      {state.status === 'idle' || state.status === 'loading' ? (
        <div className="w-full flex items-center gap-2 h-10 px-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <div className="flex-1">
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        </div>
      ) : state.status === 'error' ? (
        <MediaError />
      ) : (
        <audio
          src={state.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="w-full h-10 max-w-full bg-transparent"
        />
      )}
    </div>
  )
}

function DocumentMedia({
  url,
  name,
  mimetype,
  isMe,
  onSelectMedia,
}: {
  url: string
  name?: string
  mimetype?: string
  isMe: boolean
  onSelectMedia: () => void
}) {
  const { ref, state } = useLazyMedia(url)
  return (
    <div ref={ref}>
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg mb-1 w-full min-w-0',
          isMe ? 'bg-black/10' : 'bg-black/5',
        )}
      >
        <div className={cn('p-2 rounded-full shrink-0', isMe ? 'bg-white/20' : 'bg-primary/10')}>
          <FileText className={cn('w-5 h-5', isMe ? 'text-white' : 'text-primary')} />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="font-medium text-sm truncate" title={name}>
            {name}
          </p>
          <p
            className={cn(
              'text-[11px] uppercase truncate',
              isMe ? 'text-white/70' : 'text-muted-foreground',
            )}
          >
            {mimetype ? mimetype.split('/')[1] || 'Documento' : 'Documento'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {mimetype === 'application/pdf' && (
            <Button
              variant="ghost"
              size="icon"
              disabled={state.status !== 'loaded'}
              className={cn(
                'rounded-full w-8 h-8',
                isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onSelectMedia()
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            asChild
            disabled={state.status !== 'loaded'}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'rounded-full w-8 h-8',
              isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
            )}
          >
            <a
              href={state.status === 'loaded' ? state.url : undefined}
              download={name || 'document'}
              target="_blank"
              rel="noreferrer"
            >
              <FileDown className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>
      {(state.status === 'idle' || state.status === 'loading') && (
        <Skeleton className="h-1 w-full mb-1 rounded-full" />
      )}
    </div>
  )
}

function StickerMedia({ url }: { url: string }) {
  const { ref, state } = useLazyMedia(url)
  return (
    <div ref={ref}>
      {state.status === 'idle' || state.status === 'loading' ? (
        <LoadingBox className="w-32 h-32" />
      ) : state.status === 'error' ? (
        <MediaError />
      ) : (
        <img
          src={state.url}
          alt="sticker"
          className="w-32 h-32 object-contain drop-shadow-sm mb-1"
        />
      )}
    </div>
  )
}

function MediaError({ isMe }: { isMe?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg mb-1',
        isMe ? 'bg-black/10 text-white/80' : 'bg-black/5 text-muted-foreground',
      )}
    >
      <AlertCircle className="w-5 h-5 shrink-0" />
      <span className="text-sm italic">Falha ao carregar mídia</span>
    </div>
  )
}
