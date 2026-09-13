import PocketBase from 'pocketbase'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

// Controle de renovação concorrente de sessão (evita rajada de refresh)
let isRefreshing = false
let refreshPromise: Promise<boolean> | null = null

export async function silentAuthRefresh(): Promise<boolean> {
  if (!pb.authStore.isValid && !pb.authStore.token) {
    return false
  }

  if (isRefreshing && refreshPromise) {
    return refreshPromise
  }

  isRefreshing = true
  refreshPromise = (async () => {
    try {
      await pb.collection('users').authRefresh()
      return true
    } catch (err: any) {
      console.warn('[Session] Falha ao renovar token silenciosamente:', err?.message || err)
      // Se a renovação falhou definitivamente (401/400), limpa o authStore
      pb.authStore.clear()
      // Dispara evento global para componentes poderem reagir (ex: banner ou tela amigável)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:session_expired'))
      }
      return false
    } finally {
      isRefreshing = false
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// Hook global afterSend para interceptar 401s e tentar 1 renovação automática de token
pb.afterSend = async (response, data) => {
  if (response.status === 401) {
    // Evita loop no próprio endpoint de authRefresh ou login
    const url = response.url || ''
    if (
      url.includes('/api/collections/users/auth-with-password') ||
      url.includes('/api/collections/users/auth-refresh')
    ) {
      return data
    }

    if (pb.authStore.token) {
      const refreshed = await silentAuthRefresh()
      if (refreshed) {
        // Tenta repetir a requisição original com o novo token
        try {
          const headers = new Headers(response.headers)
          headers.set('Authorization', pb.authStore.token)
          const retryRes = await fetch(response.url, {
            method: (response as any).method || 'GET',
            headers,
          })
          if (retryRes.ok) {
            return await retryRes.json()
          }
        } catch {
          /* intentionally ignored */
        }
      }
    }
  }

  return data
}

export default pb
