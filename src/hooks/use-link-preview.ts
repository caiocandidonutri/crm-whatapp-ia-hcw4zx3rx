import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'

export type LinkPreview = {
  url: string
  title: string
  description: string
  image: string
}

// Cache em memória: por URL → preview ou null (não encontrado/erro).
// Chave do cache é a URL exata. Cobertura é o tempo da sessão (não
// persiste em sessionStorage por enquanto, pra evitar mistura de
// previews entre instâncias do app).
const cache = new Map<string, LinkPreview | null>()
// Promises em curso pra deduplicar fetches concorrentes da mesma URL
// (várias mensagens com o mesmo link na mesma conversa).
const inflight = new Map<string, Promise<LinkPreview | null>>()

async function fetchPreview(url: string): Promise<LinkPreview | null> {
  if (cache.has(url)) return cache.get(url) ?? null
  const existing = inflight.get(url)
  if (existing) return existing

  const promise = pb
    .send<LinkPreview & { success?: boolean }>(
      `/backend/v1/whatsapp/link-preview?url=${encodeURIComponent(url)}`,
      { method: 'GET' },
    )
    .then((res) => {
      // Se não tem nem título nem imagem, considera vazio (não vale render).
      if (!res || (!res.title && !res.image)) {
        return null
      }
      return {
        url: res.url || url,
        title: res.title || '',
        description: res.description || '',
        image: res.image || '',
      }
    })
    .catch(() => null)

  inflight.set(url, promise)
  const result = await promise
  inflight.delete(url)
  cache.set(url, result)
  return result
}

/**
 * Retorna o link preview para a URL informada. Faz fetch lazy quando
 * a URL muda; resultados são cacheados em memória durante a sessão.
 * Retorna null enquanto está carregando E também quando o backend não
 * conseguiu extrair OG tags úteis — o componente que usa este hook
 * deve renderizar nada nesses casos.
 */
export function useLinkPreview(url?: string): LinkPreview | null {
  const [preview, setPreview] = useState<LinkPreview | null>(() =>
    url && cache.has(url) ? (cache.get(url) ?? null) : null,
  )

  useEffect(() => {
    if (!url) {
      setPreview(null)
      return
    }
    if (cache.has(url)) {
      setPreview(cache.get(url) ?? null)
      return
    }
    let cancelled = false
    fetchPreview(url).then((p) => {
      if (!cancelled) setPreview(p)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return preview
}
