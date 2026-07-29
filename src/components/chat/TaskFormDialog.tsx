import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Calendar as CalendarIcon, Loader2, Check } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { createTask } from '@/services/tasks'
import { getCrmContactByJid } from '@/services/crm_service'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useTeamMembers } from '@/hooks/use-team-members'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chat: any
  selectedMessages: any[]
  onSuccess: () => void
}

export function TaskFormDialog({
  open,
  onOpenChange,
  chat,
  selectedMessages,
  onSuccess,
}: TaskFormDialogProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('pendente')
  const [priority, setPriority] = useState('media')
  const [dueDate, setDueDate] = useState<Date | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [crmContact, setCrmContact] = useState<any>(null)
  const [assignedTo, setAssignedTo] = useState<string>('unassigned')
  const { accountId } = useCurrentAccount()
  const { members, loading: loadingMembers } = useTeamMembers()

  useEffect(() => {
    if (open && selectedMessages.length > 0) {
      // Ordena as mensagens cronologicamente (do mais antigo pro mais novo)
      const sortedMsgs = [...selectedMessages].sort((a, b) => {
        const tA = a.timestamp || 0
        const tB = b.timestamp || 0
        return tA - tB
      })

      // Pré-preenche o Título com a primeira linha da primeira mensagem selecionada
      const firstMsgText = sortedMsgs.find((m) => m.text)?.text || ''
      const firstLine = firstMsgText.split('\n')[0].trim()
      setTitle(firstLine ? firstLine.substring(0, 80) : 'Tarefa a partir de mensagem')

      // Pré-preenche a Descrição com o resumo de todas as mensagens
      const descParts = sortedMsgs.map((msg) => {
        const dateStr = msg.timestamp
          ? format(new Date(msg.timestamp), 'dd/MM/yyyy HH:mm', { locale: ptBR })
          : ''
        const sender = msg.from_me ? 'Você' : msg.pushName || chat.name || 'Contato'
        return `> [${dateStr}] ${sender}:\n> ${msg.text || '[Mídia/Documento]'}`
      })
      setDescription(descParts.join('\n\n'))

      // Reseta os demais campos pros valores padrão
      setStatus('pendente')
      setPriority('media')
      setDueDate(undefined)
      setAssignedTo(pb.authStore.record?.id || 'unassigned')

      // Busca se o contato atual já está no CRM para fazer o vínculo
      if (chat?.remote_jid && chat?.instance_name) {
        getCrmContactByJid(chat.instance_name, chat.remote_jid)
          .then((contact) => {
            setCrmContact(contact || null)
          })
          .catch(() => setCrmContact(null))
      } else {
        setCrmContact(null)
      }
    }
  }, [open, selectedMessages, chat])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('O título da tarefa é obrigatório')
      return
    }

    setIsLoading(true)
    try {
      const user_id = pb.authStore.record?.id
      let formattedDate = undefined
      if (dueDate) {
        // Formato ISO string (aceito perfeitamente pelo PocketBase via substituição de T para espaço)
        formattedDate = dueDate.toISOString().replace('T', ' ')
      }

      await createTask({
        account_id: accountId || undefined,
        user_id,
        title: title.trim(),
        description: description.trim(),
        status: status as any,
        priority: priority as any,
        due_date: formattedDate,
        crm_contact_id: crmContact?.id,
        crm_company_id: crmContact?.company_id,
        conversation_id: chat?.id,
        linked_message_ids: selectedMessages.map((m) => m.id),
        assigned_to: assignedTo === 'unassigned' ? undefined : assignedTo,
      })

      toast.success('Tarefa criada com sucesso!')
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error('Erro ao criar tarefa: ' + getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !isLoading && onOpenChange(val)}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto flex flex-col gap-0 p-0">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-6 py-4 border-b border-border">
            <DialogTitle className="text-lg">Criar Tarefa</DialogTitle>
            <DialogDescription className="mt-1.5">
              Crie uma tarefa baseada nas {selectedMessages.length} mensagens selecionadas.
            </DialogDescription>
          </div>

          <div className="p-6 space-y-5 flex-1">
            {crmContact && (
              <div className="bg-primary/5 text-primary border border-primary/20 p-3 rounded-lg flex items-start gap-2.5 text-sm">
                <Check className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Vínculo Automático</p>
                  <p className="opacity-80">
                    Esta tarefa será vinculada ao contato do CRM{' '}
                    <strong>{crmContact.contact_name || crmContact.push_name}</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label
                htmlFor="title"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Título da Tarefa <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Retornar contato sobre orçamento"
                disabled={isLoading}
                autoFocus
                maxLength={100}
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Responsável
              </Label>
              <Select
                value={assignedTo}
                onValueChange={setAssignedTo}
                disabled={isLoading || loadingMembers}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Selecione um responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Ninguém</SelectItem>
                  {members.map((member) => {
                    const user = member.expand?.user_id
                    if (!user) return null
                    return (
                      <SelectItem key={user.id} value={user.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarImage
                              src={
                                user.avatar
                                  ? pb.files.getUrl(user, user.avatar, { thumb: '100x100' })
                                  : undefined
                              }
                            />
                            <AvatarFallback className="text-[9px]">
                              {user.name?.charAt(0) || user.email?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate max-w-[120px]">{user.name || user.email}</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </Label>
                <Select value={status} onValueChange={setStatus} disabled={isLoading}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Selecione o status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="em_andamento">Em Andamento</SelectItem>
                    <SelectItem value="concluida">Concluída</SelectItem>
                    <SelectItem value="cancelada">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Prioridade
                </Label>
                <Select value={priority} onValueChange={setPriority} disabled={isLoading}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Selecione a prioridade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Prazo (Opcional)
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal bg-background hover:bg-background/80',
                      !dueDate && 'text-muted-foreground',
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? (
                      format(dueDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                    ) : (
                      <span>Selecione uma data</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                    locale={ptBR}
                  />
                  {dueDate && (
                    <div className="p-2 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setDueDate(undefined)}
                      >
                        Limpar Data
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="description"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Descrição (Mensagens de Contexto)
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contexto da tarefa..."
                disabled={isLoading}
                className="min-h-[160px] resize-y font-mono text-sm bg-muted/30"
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border bg-muted/10 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading} className="min-w-[120px]">
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Criar Tarefa'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
