import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import pb from '@/lib/pocketbase/client'

interface AuthContextType {
  user: any
  isAuthenticated: boolean
  signUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ error: any; status?: number }>
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signOut: () => void
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<any>(() => pb.authStore.record)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, record) => {
      setUser(record)
    })

    const handleSessionExpired = () => {
      setUser(null)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('auth:session_expired', handleSessionExpired)
    }

    // Se temos um token salvo, mantemos o record já carregado enquanto tenta refresh suave.
    // NUNCA desloga imediatamente em caso de erro de rede ou indisponibilidade temporária.
    // Apenas desloga se o servidor explicitamente rejeitar com 401/403 (token inválido/expirado).
    if (pb.authStore.isValid || pb.authStore.token) {
      // Timeout de segurança: se o servidor demorar, libera o loading após 3.5s
      const timeoutId = setTimeout(() => {
        setLoading(false)
      }, 3500)

      pb.collection('users')
        .authRefresh()
        .then((authData) => {
          if (authData?.record) {
            setUser(authData.record)
          }
        })
        .catch((err: any) => {
          const status = err?.status || err?.response?.status
          if (status === 401 || status === 403) {
            pb.authStore.clear()
            setUser(null)
          } else {
            console.warn(
              '[AuthProvider] authRefresh falhou por erro transitório de rede:',
              err?.message || err,
            )
            // Se temos record no storage, mantém
            if (pb.authStore.record) {
              setUser(pb.authStore.record)
            }
          }
        })
        .finally(() => {
          clearTimeout(timeoutId)
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
    return () => {
      unsubscribe()
      if (typeof window !== 'undefined') {
        window.removeEventListener('auth:session_expired', handleSessionExpired)
      }
    }
  }, [])

  const signUp = async (name: string, email: string, password: string) => {
    try {
      const trimmedEmail = email.trim().toLowerCase()
      await pb
        .collection('users')
        .create({ name: name.trim(), email: trimmedEmail, password, passwordConfirm: password })
      const authRes = await pb.collection('users').authWithPassword(trimmedEmail, password)
      if (authRes?.record) {
        setUser(authRes.record)
      }
      return { error: null }
    } catch (error: any) {
      return { error, status: error?.status }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      const trimmedEmail = email.trim().toLowerCase()
      const authRes = await pb.collection('users').authWithPassword(trimmedEmail, password)
      if (authRes?.record) {
        setUser(authRes.record)
      }
      return { error: null, record: authRes?.record }
    } catch (error: any) {
      return { error }
    }
  }

  const signOut = () => {
    pb.authStore.clear()
  }

  const isAuthenticated = !!user

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, signUp, signIn, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
