import { useState, useRef, useEffect } from 'react'
import { Send, Bot, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { streamAgentChat } from '@/lib/skipAi'
import { streamCareAgentChat } from '@/services/crm_care_service'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_PROMPTS = [
  'Quais pacientes precisam de retorno?',
  'Gere uma mensagem de follow-up para uma paciente pós-consulta com SOP',
  'Como está o funil de atendimentos hoje?',
  'Uma paciente perguntou sobre dor pélvica, como devo responder?',
]

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Olá! Sou a Secretária de Cuidado do Dr. Caio Cândido 🙏\n\nAcompanho cada paciente com carinho — conheço sobre saúde metabólica e hormonal feminina (SOP, menopausa, intestino, inflamação, sobrepeso e mais), confirmo consultas e faço follow-ups personalizados no tom da nossa secretária.\n\nComo posso ajudar? 💛',
    },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const handleSend = async (text?: string) => {
    const message = (text || input).trim()
    if (!message || isSending) return

    setInput('')
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ])
    setIsSending(true)

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await streamCareAgentChat(message, conversationId, ctrl.signal)
      const result = await streamAgentChat(res, {
        onChunk: (_delta, full) => {
          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: full }
            return next
          })
        },
        signal: ctrl.signal,
      })
      setConversationId(result.conversation_id)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      toast.error('Erro ao falar com o agente')
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: 'Desculpe, ocorreu um erro. Tente novamente. 😔',
        }
        return next
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <Avatar className="w-10 h-10 bg-primary/10">
          <AvatarFallback className="bg-primary/10 text-primary">
            <Bot className="w-5 h-5" />
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-serif text-xl font-bold text-primary">Secretária de Cuidado</h1>
          <p className="text-xs text-muted-foreground">
            Saúde metabólica & hormonal · sempre ativa
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white/50 backdrop-blur-sm rounded-2xl border border-border/40 p-4 flex flex-col gap-3">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                  : 'bg-muted rounded-tl-sm',
              )}
            >
              {msg.content || (isSending && idx === messages.length - 1 ? '...' : msg.content)}
            </div>
          </div>
        ))}

        {messages.length === 1 && !isSending && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-xs text-muted-foreground px-1">Sugestões:</p>
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handleSend(prompt)}
                className="text-left text-sm px-3 py-2 rounded-xl bg-primary/5 hover:bg-primary/10 text-primary transition-colors border border-primary/20"
              >
                <Sparkles className="w-3.5 h-3.5 inline mr-2 opacity-60" />
                {prompt}
              </button>
            ))}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isSending}
          placeholder="Digite sua mensagem..."
          className="flex-1 bg-white border border-border rounded-2xl px-4 py-3 text-sm resize-none max-h-32 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <Button
          onClick={() => handleSend()}
          disabled={!input.trim() || isSending}
          size="icon"
          className="rounded-full h-11 w-11 shrink-0"
        >
          {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
        </Button>
      </div>
    </div>
  )
}
