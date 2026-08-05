import { cn } from '@/lib/utils'
import { useLinkPreview } from '@/hooks/use-link-preview'

export function LinkPreviewCard({ url, isMe }: { url: string; isMe: boolean }) {
  const preview = useLinkPreview(url)
  if (!preview) return null

  let hostname = ''
  try {
    hostname = new URL(preview.url).hostname
  } catch {
    hostname = preview.url
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'block mb-1 mx-1 mt-1 rounded-lg overflow-hidden bg-black/5 hover:bg-black/10 transition-colors border-l-4',
        isMe ? 'border-white/50' : 'border-primary/50',
      )}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt="Preview"
          className="w-full h-32 object-cover"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      )}
      <div className="p-2">
        {preview.title && <h4 className="font-bold text-sm line-clamp-1">{preview.title}</h4>}
        {preview.description && (
          <p className="text-xs opacity-80 line-clamp-2 mt-0.5">{preview.description}</p>
        )}
        <span className="text-[10px] opacity-60 uppercase mt-1 block truncate">{hostname}</span>
      </div>
    </a>
  )
}
