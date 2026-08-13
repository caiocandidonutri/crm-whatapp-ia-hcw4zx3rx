import { useCallback, useEffect, useState } from 'react'
import { getMediaObjectUrl, releaseMediaObjectUrl, retryMedia } from '@/lib/media-throttle'
import { useInView } from '@/hooks/use-in-view'

type MediaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; url: string }
  | { status: 'error' }

export interface UseLazyMediaResult {
  ref: React.RefObject<HTMLDivElement | null>
  state: MediaState
  /** Dispara uma nova tentativa de carregamento (usado pelo "tentar novamente"). */
  retry: () => void
}

/**
 * Carrega uma mídia do PocketBase de forma lazy e throttled.
 *
 * Combina:
 *  - `useInView`: só dispara quando o card entra na viewport (ou próximo).
 *  - `media-throttle`: no máximo 3 downloads simultâneos, 200ms entre cada.
 *
 * Retorna o estado (idle/loading/loaded/error), a object URL quando pronta e
 * uma função `retry` para re-tentar o download após uma falha (o clique no
 * placeholder "Toque para tentar novamente" chama essa função).
 *
 * O object URL é cacheado em `media-throttle` para reusar entre mounts.
 *
 * Se `src` estiver vazio, fica em `idle` (não tenta baixar).
 */
export function useLazyMedia(src: string | undefined | null): UseLazyMediaResult {
  const [ref, inView] = useInView<HTMLDivElement>('300px')
  const [state, setState] = useState<MediaState>({ status: 'idle' })

  const load = useCallback((url: string, isInView: boolean) => {
    if (!url || !isInView) return
    let cancelled = false
    setState({ status: 'loading' })

    getMediaObjectUrl(url)
      .then((objectUrl) => {
        if (!cancelled) setState({ status: 'loaded', url: objectUrl })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
      // Libera a ref deste mount; o cache global decide se revoga.
      releaseMediaObjectUrl(url)
    }
  }, [])

  useEffect(() => {
    if (!src) {
      setState({ status: 'idle' })
      return
    }
    if (!inView) return
    const cleanup = load(src, inView)
    return cleanup
  }, [src, inView, load])

  const retry = useCallback(() => {
    if (!src) return
    let cancelled = false
    setState({ status: 'loading' })

    retryMedia(src)
      .then((objectUrl) => {
        if (!cancelled) setState({ status: 'loaded', url: objectUrl })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [src])

  return { ref, state, retry }
}
