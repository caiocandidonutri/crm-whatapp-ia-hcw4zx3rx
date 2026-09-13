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
  const [user, setUser] = useState<any>(pb.authStore.record)
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

    if (pb.authStore.isValid || pb.authStore.token) {
      pb.collection('users')
        .authRefresh()
        .catch(() => {
          pb.authStore.clear()
          setUser(null)
        })
        .finally(() => setLoading(false))
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
      await pb.collection('users').create({ name, email, password, passwordConfirm: password })
      await pb.collection('users').authWithPassword(email, password)
      return { error: null }
    } catch (error: any) {
      return { error, status: error.status }
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      await pb.collection('users').authWithPassword(email, password)
      return { error: null }
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
