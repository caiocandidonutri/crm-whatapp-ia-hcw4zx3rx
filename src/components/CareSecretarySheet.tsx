import { useState, useRef, useEffect, useCallback } from 'react'
import { Heart, Send, Loader2, X } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Task, CrmContact } from '@/types/models'
import { getCareCategoryMeta } from '@/lib/task-meta'
import { streamCareAgentChat } from '@/services/crm_care_service'
import { streamAgentChat } from '@/lib/skipAi'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Contexto de contato (paciente) injetado pela conversa do WhatsApp ao
 * abrir a Secretária a partir do ChatArea. Quem abre via Tarefas continua
 * usando `contextTask`; quem abre via chat usa `contactContext`. Ambos
 * são mutuamente exclusivos na prática, mas o componente tolera os dois.
 */
export interface CareContactContext {
  /** id do crm_contacts (quando o contato já está no CRM) */
  contactId?: string
  /** nome de exibição do paciente */
  name: string
  /** telefone formatado ou JID do WhatsApp */
  phone?: string
  jid?: string
  /** estágio do pipeline (stage do crm_contacts) */
  stage?: string
  /** status de cuidado (care_status) */
  careStatus?: string
  /** data da última consulta (converted_at do crm_contacts) */
  lastConsultationAt?: string
  /** ação sugerida pela IA, quando disponível */
  aiSuggestedAction?: string
}

interface CareSecretarySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contextTask: Task | null
  /** Contexto injetado pelo ChatArea (conversa do WhatsApp). */
  contactContext?: CareContactContext | null
}

export function CareSecretarySheet({
  open,
  onOpenChange,
  contextTask,
  contactContext,
}: CareSecretarySheetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const contextSentRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      contextSentRef.current = false
    } else {
      setMessages([])
      setConversationId(null)
      setInput('')
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [open])

  useEffect(() => {
    if (open && contextTask && !contextSentRef.current) {
      contextSentRef.current = true
      const crmContact = contextTask.expand?.crm_contact_id
      const patientName = crmContact?.contact_name || crmContact?.push_name || contextTask.title
      const careCategory = contextTask.care_category || 'sem_categoria'
      const careMeta = getCareCategoryMeta(careCategory)
      const action = crmContact?.ai_suggested_action || ''

      let contextMsg = `Estou trabalhando na tarefa "${contextTask.title}".\nPaciente: ${patientName}\nCategoria: ${careMeta.label}`
      if (action) contextMsg += `\nAção sugerida pela IA: ${action}`
      contextMsg += '\n\nPode me ajudar a resolver esse caso?'

      sendMessage(contextMsg)
    }
  }, [open, contextTask])

  // Contexto vindo do ChatArea (conversa do WhatsApp). Envia UMA mensagem
  // de contexto automaticamente ao abrir, descrevendo o paciente ativo:
  // nome, telefone/JID, estágio, status de cuidado, última consulta e id
  // do CRM. A IA usa isso pra responder com conhecimento do caso.
  useEffect(() => {
    if (open && contactContext && !contextSentRef.current) {
      contextSentRef.current = true
      const ctx = contactContext
      const parts: string[] = [`Paciente: ${ctx.name}`]
      if (ctx.phone) parts.push(`Telefone: ${ctx.phone}`)
      else if (ctx.jid) parts.push(`JID: ${ctx.jid}`)
      if (ctx.stage) parts.push(`Estágio do pipeline: ${ctx.stage}`)
      if (ctx.careStatus) parts.push(`Status de cuidado: ${ctx.careStatus}`)
      if (ctx.lastConsultationAt) {
        try {
          parts.push(
            `Última consulta: ${new Date(ctx.lastConsultationAt).toLocaleDateString('pt-BR')}`,
          )
        } catch {
          parts.push(`Última consulta: ${ctx.lastConsultationAt}`)
        }
      }
      if (ctx.contactId) parts.push(`ID no CRM: ${ctx.contactId}`)
      if (ctx.aiSuggestedAction) parts.push(`Ação sugerida pela IA: ${ctx.aiSuggestedAction}`)

      const contextMsg =
        `Abri a conversa do WhatsApp deste paciente no CRM:\n${parts.join('\n')}\n\n` +
        'Pode me ajudar com o cuidado dele(a)?'
      sendMessage(contextMsg)
    }
  }, [open, contactContext])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setInput('')
      setIsStreaming(true)
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await streamCareAgentChat(text, conversationId, controller.signal)
        const result = await streamAgentChat(response, {
          onChunk: (_delta, full) => {
            setMessages((prev) => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: full }
              return updated
            })
          },
          signal: controller.signal,
        })

        if (result.conversation_id) {
          setConversationId(result.conversation_id)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setMessages((prev) => {
          const updated = [...prev]
          if (
            updated.length > 0 &&
            updated[updated.length - 1].role === 'assistant' &&
            !updated[updated.length - 1].content
          ) {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: 'Erro ao conectar com a secretária. Tente novamente.',
            }
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [isStreaming, conversationId],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center">
              <Heart className="w-4 h-4 text-rose-600" />
            </div>
            <div>
              <span className="block">Secretária de Cuidado</span>
              <span className="text-xs font-normal text-muted-foreground">
                Assistente de atendimento
              </span>
            </div>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-3 min-h-full">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Heart className="w-10 h-10 mx-auto mb-3 text-rose-300" />
                <p className="text-sm">Olá! Sou a Secretária de Cuidado.</p>
                <p className="text-xs mt-1">Como posso ajudar você hoje?</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm',
                  )}
                >
                  {msg.content ||
                    (isStreaming && idx === messages.length - 1 ? (
                      <Loader2 className="w-4 h-4 animate-spin inline" />
                    ) : (
                      ''
                    ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-3 border-t border-border shrink-0 flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            disabled={isStreaming}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 rounded-full"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
