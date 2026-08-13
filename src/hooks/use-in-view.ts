import { useEffect, useRef, useState } from 'react'

/**
 * Observa se o elemento referenciado está dentro da viewport (ou próximo
 * dela) via IntersectionObserver. Usado pelo carregamento lazy de mídias
 * para só disparar o download quando o card de mídia entra na área visível
 * — evita disparar dezenas de requisições `.ogg`/`.jpg` de uma vez e estourar
 * o rate limit (429) do PocketBase.
 *
 * `rootMargin` permite pré-carregar um pouco antes de o item ficar visível
 * (ex.: '200px' começa o download quando o card está a 200px da viewport).
 */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin: string = '200px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Se o navegador não suporta IntersectionObserver, assume visível —
    // preferimos carregar a mídia a quebrar a exibição.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    let unobserved = false
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            // Uma vez visível, não precisa mais observar — a mídia já
            // está carregando. Evita churn desnecessário ao rolar.
            if (!unobserved) {
              unobserved = true
              observer.disconnect()
            }
          }
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return [ref, inView]
}

export default useInView
