import React, { createContext, useContext, useState, ReactNode } from 'react'
import { Chat, initialChats } from '@/lib/mock-data'

type AppState = {
  user: { name: string; email: string; avatar: string } | null
  chats: Chat[]
  login: (name: string, email: string) => void
  logout: () => void
  markAsRead: (chatId: string) => void
  sendMessage: (chatId: string, text: string) => void
}

const AppContext = createContext<AppState | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ name: string; email: string; avatar: string } | null>({
    name: 'Fabiano',
    email: 'fabiano@empresa.com',
    avatar: 'https://img.usecurling.com/ppl/thumbnail?gender=male&seed=10',
  })
  const [chats, setChats] = useState<Chat[]>(initialChats)

  const login = (name: string, email: string) => {
    setUser({
      name,
      email,
      avatar: `https://img.usecurling.com/ppl/thumbnail?seed=${name}`,
    })
  }

  const logout = () => setUser(null)

  const markAsRead = (chatId: string) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? { ...c, unread: 0, messages: c.messages.map((m) => ({ ...m, isRead: true })) }
          : c,
      ),
    )
  }

  const sendMessage = (chatId: string, text: string) => {
    const newMessage = {
      id: Math.random().toString(),
      senderId: 'me',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: true,
    }

    setChats((prev) => {
      const chatIndex = prev.findIndex((c) => c.id === chatId)
      if (chatIndex === -1) return prev

      const newChats = [...prev]
      const chat = { ...newChats[chatIndex] }
      chat.messages = [...chat.messages, newMessage]
      newChats.splice(chatIndex, 1)
      newChats.unshift(chat) // Move to top
      return newChats
    })
  }

  return (
    <AppContext.Provider value={{ user, chats, login, logout, markAsRead, sendMessage }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppStore() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useAppStore must be used within AppProvider')
  return context
}
