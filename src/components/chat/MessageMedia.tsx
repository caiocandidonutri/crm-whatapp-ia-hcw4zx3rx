import {
  FileText,
  FileDown,
  Eye,
  AlertCircle,
  Loader2,
  Play,
  Music,
  ImageIcon,
  Video,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useLazyMedia } from '@/hooks/use-lazy-media'

export type MediaPreviewItem = {
  url: string
  type: string
  mimetype?: string
  name?: string
}

type SelectedMedia = { url: string; type: string; mimetype?: string; name?: string }

interface MessageMediaProps {
  media: { type: string; url: string; name?: string; mimetype?: string } | undefined
  isMe: boolean
  status?: string
  onSelectMedia: (media: SelectedMedia) => void
}

function SkeletonBox({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        'mb-1 rounded-lg bg-black/10 animate-pulse flex items-center justify-center',
        className,
      )}
    >
      {children ?? <Loader2 className="w-5 h-5 text-muted-foreground/60 animate-spin" />}
    </div>
  )
}

export function MessageMedia({ media, isMe, status, onSelectMedia }: MessageMediaProps) {
  // status 'media_failed' agora só é exibido quando não há URL de mídia.
  // Se há URL, tentamos carregar via lazy/throttle; só mostramos "indisponível"
  // se o fetch realmente falhar (state error), não por 429 transitório.
  if (status === 'media_failed' && (!media || !media.url)) {
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
      <LazyImage
        url={url}
        isMe={isMe}
        onSelectMedia={onSelectMedia}
        mimetype={mimetype}
        name={name}
      />
    )
  if (type === 'video') return <LazyVideo url={url} isMe={isMe} />
  if (type === 'audio') return <LazyAudio url={url} isMe={isMe} />
  if (type === 'document')
    return (
      <LazyDocument
        url={url}
        name={name}
        mimetype={mimetype}
        isMe={isMe}
        onSelectMedia={onSelectMedia}
        type="document"
      />
    )
  if (type === 'sticker') return <LazySticker url={url} />

  return null
}

// ---------------------------------------------------------------------------
// Sub-componentes que usam o hook de mídia lazy + throttle.
// Cada um renderiza um skeleton enquanto carrega, e um aviso de erro em vez
// de "Mídia indisponível" imediato. O IntersectionObserver (dentro do hook)
// garante que o download só dispara quando o card entra na viewport.
// ---------------------------------------------------------------------------

type MediaItem = { type: string; url: string; name?: string; mimetype?: string }

function LazyImage({
  url,
  isMe,
  onSelectMedia,
  mimetype,
  name,
}: {
  url: string
  isMe: boolean
  onSelectMedia: (m: SelectedMedia) => void
  mimetype?: string
  name?: string
}) {
  const { ref, state, retry } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1">
      {state.status === 'loaded' ? (
        <img
          src={state.url}
          alt="attachment"
          loading="lazy"
          className="rounded-lg max-w-full w-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onSelectMedia({ url, type: 'image', mimetype, name })
          }}
        />
      ) : state.status === 'error' ? (
        <FailedMedia isMe={isMe} onRetry={retry} icon={ImageIcon} className="w-[220px] h-[120px]" />
      ) : (
        <SkeletonBox className="w-[220px] h-[180px]">
          <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
        </SkeletonBox>
      )}
    </div>
  )
}

function LazyVideo({ url, isMe }: { url: string; isMe: boolean }) {
  const { ref, state, retry } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1">
      {state.status === 'loaded' ? (
        <video
          src={state.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg max-w-full w-auto max-h-[300px] object-cover cursor-pointer"
        />
      ) : state.status === 'error' ? (
        <FailedMedia isMe={isMe} onRetry={retry} icon={Video} className="w-[260px] h-[160px]" />
      ) : (
        <SkeletonBox className="w-[260px] h-[200px]">
          <Play className="w-6 h-6 text-muted-foreground/40" />
        </SkeletonBox>
      )}
    </div>
  )
}

function LazyAudio({ url, isMe }: { url: string; isMe: boolean }) {
  const { ref, state, retry } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1 rounded-xl min-w-[200px] w-full flex items-center">
      {state.status === 'loaded' ? (
        <audio
          src={state.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="w-full h-10 max-w-full bg-transparent"
        />
      ) : state.status === 'error' ? (
        <FailedMedia isMe={isMe} onRetry={retry} compact icon={Music} />
      ) : (
        <div
          className={cn(
            'w-full h-10 rounded-lg flex items-center gap-2 px-3',
            isMe ? 'bg-black/10 text-white/80' : 'bg-black/5 text-muted-foreground',
          )}
        >
          <Music className="w-4 h-4 shrink-0" />
          <span className="text-xs">Carregando áudio…</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />
        </div>
      )}
    </div>
  )
}

function LazyDocument({
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
  onSelectMedia: (m: SelectedMedia) => void
  type: string
}) {
  const { ref, state, retry } = useLazyMedia(url)
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
          {state.status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin self-center text-muted-foreground" />
          ) : state.status === 'error' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                retry()
              }}
              className="flex items-center gap-1 text-[11px] text-destructive self-center hover:opacity-80"
            >
              <RotateCcw className="w-3 h-3" />
              Tentar
            </button>
          ) : null}
          {state.status === 'loaded' && mimetype === 'application/pdf' && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'rounded-full w-8 h-8',
                isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onSelectMedia({ url, type: 'document', mimetype, name })
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
          )}
          {state.status === 'loaded' && (
            <Button
              variant="ghost"
              size="icon"
              asChild
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'rounded-full w-8 h-8',
                isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
              )}
            >
              <a href={state.url} download={name || 'document'} target="_blank" rel="noreferrer">
                <FileDown className="w-4 h-4" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function LazySticker({ url }: { url: string }) {
  const { ref, state, retry } = useLazyMedia(url)
  return (
    <div ref={ref} className="mb-1">
      {state.status === 'loaded' ? (
        <img
          src={state.url}
          alt="sticker"
          loading="lazy"
          className="w-32 h-32 object-contain drop-shadow-sm"
        />
      ) : state.status === 'error' ? (
        <button
          onClick={retry}
          className="w-32 h-32 flex flex-col items-center justify-center gap-1 bg-black/5 rounded-lg hover:bg-black/10 transition-colors"
        >
          <AlertCircle className="w-6 h-6 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Tentar novamente</span>
        </button>
      ) : (
        <SkeletonBox className="w-32 h-32" />
      )}
    </div>
  )
}

/**
 * Pré-visualização de mídia dentro do DialogContent (modal). Usa o mesmo
 * carregamento lazy + throttle do `useLazyMedia` para não disparar um fetch
 * direto (que estouraria o 429 quando várias mídias estão abertas/na lista).
 *
 * Renderiza um skeleton enquanto carrega e, em caso de erro, um botão de
 * "tentar novamente".
 */
export function LazyMediaPreview({
  url,
  type,
  className,
}: {
  url: string
  type: 'image' | 'pdf'
  className?: string
}) {
  const { ref, state, retry } = useLazyMedia(url)
  if (state.status === 'loaded') {
    if (type === 'image') {
      return <img src={state.url} alt="Preview" className={className} />
    }
    return <iframe src={state.url} className={className} title="PDF Preview" />
  }
  if (state.status === 'error') {
    return (
      <button
        type="button"
        onClick={retry}
        className="flex flex-col items-center justify-center gap-2 p-8 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
      >
        <AlertCircle className="w-8 h-8" />
        <span className="text-sm">Toque para tentar novamente</span>
      </button>
    )
  }
  return (
    <div
      ref={ref}
      className={cn('flex items-center justify-center bg-white/5 rounded-lg', className)}
    >
      <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
    </div>
  )
}

function FailedMedia({
  isMe,
  onRetry,
  compact,
  icon: Icon = AlertCircle,
  className,
}: {
  isMe: boolean
  onRetry: () => void
  compact?: boolean
  icon?: typeof AlertCircle
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onRetry()
      }}
      className={cn(
        'mb-1 flex flex-col items-center justify-center gap-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity',
        compact ? 'p-2' : 'p-3',
        isMe ? 'bg-black/10 text-white/80' : 'bg-black/5 text-muted-foreground',
        className,
      )}
    >
      <Icon className="w-5 h-5 shrink-0 opacity-70" />
      <span className="text-[11px] italic text-center leading-tight">
        Toque para tentar novamente
      </span>
    </button>
  )
}
