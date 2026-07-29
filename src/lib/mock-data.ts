export type Message = {
  id: string
  senderId: string
  pushName?: string
  text?: string
  media?: {
    type: 'image' | 'video' | 'document' | 'audio' | 'sticker'
    url: string
    name?: string
    mimetype?: string
  }
  linkPreview?: { url: string; title: string; description: string; thumbnailB64?: string }
  reactions?: { emoji: string; participant: string }[]
  timestamp: string
  isRead: boolean
  status?: string
}

export type Chat = {
  id: string
  type: 'individual' | 'group'
  name: string
  unread: number
  messages: Message[]
  avatar: string
  instance_name?: string
  remote_jid?: string
  groupDetails?: { participants: number; colors: Record<string, string> }
  lastMessage?: { text: string; timestamp: string; fromMe?: boolean; type?: string }
}

const mockAvatars = [
  'https://img.usecurling.com/ppl/thumbnail?gender=female&seed=1',
  'https://img.usecurling.com/ppl/thumbnail?gender=male&seed=2',
  'https://img.usecurling.com/ppl/thumbnail?gender=female&seed=3',
  'https://img.usecurling.com/ppl/thumbnail?gender=male&seed=4',
  'https://img.usecurling.com/ppl/thumbnail?gender=female&seed=5',
]

const groupColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export const initialChats: Chat[] = [
  {
    id: 'c1',
    type: 'individual',
    name: 'Ana Silva',
    unread: 2,
    avatar: mockAvatars[0],
    messages: [
      {
        id: 'm1',
        senderId: 'c1',
        text: 'Olá Fabiano, tudo bem?',
        timestamp: '09:30',
        isRead: true,
      },
      {
        id: 'm2',
        senderId: 'me',
        text: 'Tudo ótimo Ana! E você?',
        timestamp: '09:32',
        isRead: true,
      },
      {
        id: 'm3',
        senderId: 'c1',
        text: 'Preciso de ajuda com aquele relatório.',
        timestamp: '10:15',
        isRead: false,
      },
      {
        id: 'm4',
        senderId: 'c1',
        text: 'Pode me enviar o PDF?',
        timestamp: '10:16',
        isRead: false,
      },
    ],
  },
  {
    id: 'c2',
    type: 'group',
    name: 'Equipe de Vendas',
    unread: 5,
    avatar: 'https://img.usecurling.com/p/128/128?q=team&color=blue',
    groupDetails: {
      participants: 12,
      colors: { Carlos: groupColors[0], Mariana: groupColors[1] },
    },
    messages: [
      { id: 'm5', senderId: 'Carlos', text: 'Bom dia equipe!', timestamp: '08:00', isRead: true },
      {
        id: 'm6',
        senderId: 'Mariana',
        text: 'Fechamos o contrato com a Tech Corp!',
        timestamp: '08:45',
        isRead: true,
      },
      {
        id: 'm7',
        senderId: 'Carlos',
        media: { type: 'document', url: '#', name: 'Contrato_TechCorp.pdf' },
        timestamp: '08:46',
        isRead: false,
      },
    ],
  },
  {
    id: 'c3',
    type: 'individual',
    name: 'Pedro Henrique',
    unread: 0,
    avatar: mockAvatars[1],
    messages: [
      {
        id: 'm8',
        senderId: 'me',
        text: 'Reunião confirmada para as 14h.',
        timestamp: 'Ontem',
        isRead: true,
      },
      { id: 'm9', senderId: 'c3', text: 'Perfeito, estarei lá.', timestamp: 'Ontem', isRead: true },
    ],
  },
  {
    id: 'c4',
    type: 'group',
    name: 'Conexão RH',
    unread: 1,
    avatar: 'https://img.usecurling.com/p/128/128?q=network&color=purple',
    groupDetails: {
      participants: 45,
      colors: { Juliana: groupColors[2], Roberto: groupColors[3] },
    },
    messages: [
      {
        id: 'm10',
        senderId: 'Juliana',
        text: 'Alguém tem indicação para vaga de dev pleno?',
        timestamp: '11:20',
        isRead: false,
      },
    ],
  },
  {
    id: 'c5',
    type: 'individual',
    name: 'Mariana Costa',
    unread: 0,
    avatar: mockAvatars[2],
    messages: [
      {
        id: 'm11',
        senderId: 'c5',
        media: { type: 'image', url: 'https://img.usecurling.com/p/400/300?q=office' },
        timestamp: 'Segunda',
        isRead: true,
      },
      {
        id: 'm12',
        senderId: 'me',
        text: 'Ficou ótimo o novo layout da sala!',
        timestamp: 'Segunda',
        isRead: true,
      },
    ],
  },
]
