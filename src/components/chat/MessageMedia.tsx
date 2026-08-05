import { FileText, FileDown, Eye, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type SelectedMedia = { url: string; type: string; mimetype?: string; name?: string }

interface MessageMediaProps {
  media: { type: string; url: string; name?: string; mimetype?: string } | undefined
  isMe: boolean
  status?: string
  onSelectMedia: (media: SelectedMedia) => void
}

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
  if (!media) return null
  const { type, url, name, mimetype } = media

  if (type === 'image')
    return (
      <img
        src={url}
        alt="attachment"
        className="rounded-lg mb-1 max-w-full w-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
        onClick={(e) => {
          e.stopPropagation()
          onSelectMedia({ url, type, mimetype, name })
        }}
      />
    )

  if (type === 'video')
    return (
      <video
        src={url}
        controls
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg mb-1 max-w-full w-auto max-h-[300px] object-cover cursor-pointer"
      />
    )

  if (type === 'audio')
    return (
      <div className="mb-1 rounded-xl min-w-[200px] w-full flex items-center">
        <audio
          src={url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="w-full h-10 max-w-full bg-transparent"
        />
      </div>
    )

  if (type === 'document')
    return (
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
              className={cn(
                'rounded-full w-8 h-8',
                isMe ? 'hover:bg-black/20 text-white' : 'hover:bg-black/10 text-primary',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onSelectMedia({ url, type, mimetype, name })
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
          )}
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
            <a href={url} download={name || 'document'} target="_blank" rel="noreferrer">
              <FileDown className="w-4 h-4" />
            </a>
          </Button>
        </div>
      </div>
    )

  if (type === 'sticker')
    return <img src={url} alt="sticker" className="w-32 h-32 object-contain drop-shadow-sm mb-1" />

  return null
}
