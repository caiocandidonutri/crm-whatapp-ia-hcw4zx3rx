import { useEffect, useState } from 'react'
import { getMediaObjectUrl, releaseMediaObjectUrl } from '@/lib/media-throttle'
import { useInView } from '@/hooks/use-in-view'

type MediaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; url: string }
  | { status: 'error' }

/**
 * Carrega uma mídia do PocketBase de forma lazy e throttled.
 *
 * Combina:
 *  - `useInView`: só dispara quando o card entra na viewport (ou próximo).
 *  - `media-throttle`: no máximo 3 downloads simultâneos, 200ms entre cada.
 *
 * Retorna o estado (idle/loading/loaded/error) e a object URL quando pronta.
 * O object URL é cacheado em `media-throttle` para reusar entre mounts.
 *
 * Se `src` estiver vazio, fica em `idle` (não tenta baixar).
 */
export function useLazyMedia(src: string | undefined | null): {
  ref: React.RefObject<HTMLDivElement | null>
  state: MediaState
} {
  const [ref, inView] = useInView<HTMLDivElement>('300px')
  const [state, setState] = useState<MediaState>({ status: 'idle' })

  useEffect(() => {
    if (!src) {
      setState({ status: 'idle' })
      return
    }
    if (!inView) return

    let cancelled = false
    setState({ status: 'loading' })

    getMediaObjectUrl(src)
      .then((url) => {
        if (!cancelled) setState({ status: 'loaded', url })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
      // Libera a ref deste mount; o cache global decide se revoga.
      releaseMediaObjectUrl(src)
    }
  }, [src, inView])

  return { ref, state }
}
