import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  MessageSquare,
  Trash2,
  Phone,
  Image as ImageIcon,
  Mic,
  Video,
  FileText,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatPhoneBR } from '@/hooks/use-crm'
import { getDisplayName, isInvalidContactName } from '@/lib/whatsapp-mappers'
import { CrmContact, CrmCompany } from '@/types/models'
import { CompanyAutocomplete } from './CompanyAutocomplete'
import { linkContactToCompany } from '@/services/crm_companies_service'
import { useTeamMembers } from '@/hooks/use-team-members'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
import { useCategories } from '@/hooks/use-categories'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useCrmStages } from '@/hooks/use-crm-stages'
import { stageStyle } from '@/lib/stage-colors'
import { DEFAULT_STAGES } from '@/services/crm_stages_service'

interface CrmContactDetailProps {
  contactId: string | null
  onClose: () => void
  onUpdate: () => void
  onDelete: () => void
}

export function CrmContactDetail({
  contactId,
  onClose,
  onUpdate,
  onDelete,
}: CrmContactDetailProps) {
  const navigate = useNavigate()
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<any[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showAllMessages, setShowAllMessages] = useState(false)

  const [contactName, setContactName] = useState('')
  const [stage, setStage] = useState('')
  const [notes, setNotes] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [assignedTo, setAssignedTo] = useState<string>('unassigned')
  // Empresa vinculada — gerenciada pelo CompanyAutocomplete. Salvar
  // ali é imediato (PATCH no contato), então não vai pelo botão "Salvar".
  const [company, setCompany] = useState<CrmCompany | null>(null)
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const { members, loading: loadingMembers } = useTeamMembers()
  const { account } = useCurrentAccount()
  const { categories } = useCategories(account?.id)
  const { stages } = useCrmStages(account?.id)
  const stageOptions = stages.length > 0 ? stages : DEFAULT_STAGES

  const isDirty =
    contact &&
    (contactName !== (contact.contact_name || '') ||
      stage !== contact.stage ||
      notes !== (contact.notes || '') ||
      role !== (contact.role || '') ||
      email !== (contact.email || '') ||
      JSON.stringify(categoryIds) !== JSON.stringify(contact.category_ids || []))

  useEffect(() => {
    if (!contactId) {
      setContact(null)
      setMessages([])
      return
    }

    let isMounted = true
    setLoading(true)

    pb.collection('crm_contacts')
      .getOne<CrmContact>(contactId, { expand: 'company_id' })
      .then((data) => {
        if (!isMounted) return
        setContact(data)
        setContactName(isInvalidContactName(data.contact_name) ? '' : data.contact_name || '')
        setStage(data.stage)
        setNotes(data.notes || '')
        setRole(data.role || '')
        setEmail(data.email || '')
        setAssignedTo(data.assigned_to || 'unassigned')
        setCompany(data.expand?.company_id || null)
        setCategoryIds(data.category_ids || [])

        setLoadingMessages(true)
        setShowAllMessages(false)
        pb.collection('whatsapp_messages')
          .getList(1, 100, {
            filter: `instance_name = '${data.instance_name}' && remote_jid = '${data.jid}'`,
            sort: '-timestamp',
          })
          .then((res) => {
            if (!isMounted) return
            setMessages(res.items)
          })
          .catch((err) => {
            console.error('Error fetching messages', err)
          })
          .finally(() => {
            if (isMounted) setLoadingMessages(false)
          })
      })
      .catch((err) => {
        console.error(err)
        toast.error('Erro ao carregar contato')
        if (isMounted) onClose()
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [contactId, onClose])

  const handleSave = async () => {
    if (!contact) return
    try {
      setSaving(true)
      await pb.collection('crm_contacts').update(contact.id, {
        contact_name: contactName,
        stage: stage,
        notes: notes,
        role: role,
        email: email,
        category_ids: categoryIds,
      })
      toast.success('Alterações salvas')
      onUpdate()
      setContact((prev) =>
        prev
          ? {
              ...prev,
              contact_name: contactName,
              stage,
              notes,
              role,
              email,
              category_ids: categoryIds,
            }
          : null,
      )
    } catch (err) {
      console.error(err)
      toast.error('Erro ao salvar alterações')
    } finally {
      setSaving(false)
    }
  }

  const handleAssignedToChange = async (val: string) => {
    if (!contact) return
    try {
      const payload = val === 'unassigned' ? '' : val
      await pb.collection('crm_contacts').update(contact.id, { assigned_to: payload })
      setAssignedTo(val)
      setContact((prev) => (prev ? { ...prev, assigned_to: payload } : null))
      toast.success('Responsável atualizado')
      onUpdate()
    } catch (err) {
      console.error(err)
      toast.error('Erro ao atualizar responsável')
    }
  }

  const handleCompanyChange = async (selected: CrmCompany | null) => {
    if (!contact) return
    try {
      await linkContactToCompany(contact.id, selected ? selected.id : null)
      setCompany(selected)
      setContact((prev) =>
        prev ? { ...prev, company_id: selected ? selected.id : undefined } : null,
      )
      toast.success(selected ? `Vinculado a ${selected.name}` : 'Empresa removida')
      onUpdate()
    } catch (err) {
      console.error(err)
      toast.error('Erro ao vincular empresa')
    }
  }

  const handleDelete = async () => {
    if (!contact) return
    try {
      await pb.collection('crm_contacts').delete(contact.id)
      toast.success('Contato removido do CRM')
      onDelete()
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Erro ao remover contato')
    }
  }

  const headerStage = contact ? stageOptions.find((s) => s.key === contact.stage) : undefined

  return (
    <Sheet open={!!contactId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-border/50 bg-background/95 backdrop-blur-xl z-50">
        <SheetHeader className="sr-only">
          <SheetTitle>Detalhes do Contato</SheetTitle>
          <SheetDescription>
            Gerencie as informações e veja as últimas mensagens do contato.
          </SheetDescription>
        </SheetHeader>

        <div className="p-6 bg-muted/30 border-b border-border/50">
          {loading ? (
            <div className="flex gap-4 items-center">
              <Skeleton className="w-20 h-20 rounded-full shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-5 w-24 rounded-full mt-2" />
              </div>
            </div>
          ) : contact ? (
            <div className="flex gap-5 items-start">
              <Avatar className="w-20 h-20 border-2 border-background shadow-sm shrink-0">
                <AvatarImage src={contact.avatar_url} />
                <AvatarFallback className="text-3xl font-serif bg-primary/10 text-primary">
                  {(contact.contact_name || contact.push_name || 'S').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5 pt-1 min-w-0">
                <h2 className="font-serif text-2xl font-bold text-primary tracking-tight truncate">
                  {getDisplayName(contact.contact_name, contact.jid)}
                </h2>
                <div className="flex items-center gap-1.5 text-muted-foreground font-sans">
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-sm">{formatPhoneBR(contact.phone) || '-'}</span>
                </div>
                <div className="mt-1">
                  <Badge
                    variant="secondary"
                    className={cn('text-xs border-0', stageStyle(headerStage?.color).badge)}
                  >
                    {headerStage?.label || contact.stage}
                  </Badge>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-6 flex flex-col gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                Informações
              </h3>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="contactName"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Nome do contato
                  </Label>
                  <Input
                    id="contactName"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Ex: João Silva"
                    className="h-9 bg-white/50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Nome no WhatsApp
                    </Label>
                    <div
                      className="h-9 px-3 py-2 border border-border/50 bg-muted/30 rounded-md text-sm text-muted-foreground truncate"
                      title={contact?.push_name || '-'}
                    >
                      {contact?.push_name || '-'}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                      ID do Contato
                    </Label>
                    <div
                      className="h-9 px-3 py-2 border border-border/50 bg-muted/30 rounded-md text-xs font-mono text-muted-foreground truncate"
                      title={contact?.jid}
                    >
                      {contact?.jid?.split('@')[0]}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                Empresa & Responsável
              </h3>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Responsável</Label>
                  <Select
                    value={assignedTo}
                    onValueChange={handleAssignedToChange}
                    disabled={loadingMembers}
                  >
                    <SelectTrigger className="h-9 bg-white/50">
                      <SelectValue placeholder="Selecione um responsável" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <UserCircle2 className="w-4 h-4" />
                          <span>Ninguém atribuído</span>
                        </div>
                      </SelectItem>
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
                              <span className="truncate max-w-[150px]">
                                {user.name || user.email}
                              </span>
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Vincular a uma empresa
                  </Label>
                  <CompanyAutocomplete selectedCompany={company} onChange={handleCompanyChange} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Cargo</Label>
                    <Input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="Ex.: Product Manager"
                      className="h-9 bg-white/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Email</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="joao@empresa.com"
                      type="email"
                      className="h-9 bg-white/50"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                Status & Notas
              </h3>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Fase no Funil</Label>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger className="h-9 bg-white/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stageOptions.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 flex flex-col">
                  <Label className="text-xs font-medium text-muted-foreground">Categorias</Label>
                  <CategoryPicker
                    categories={categories}
                    selectedIds={categoryIds}
                    onChange={setCategoryIds}
                    className="w-full bg-white/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Anotações Internas
                  </Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Adicione informações importantes, lembretes ou histórico do lead..."
                    className="min-h-[100px] resize-y bg-white/50"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                  Últimas Mensagens
                </h3>
                <span className="text-xs text-muted-foreground">{messages.length} mensagen(s)</span>
              </div>

              <div className="bg-white/40 border border-border/50 rounded-2xl p-4 flex flex-col gap-2">
                {loadingMessages ? (
                  <div className="space-y-4">
                    <Skeleton className="h-12 w-3/4 ml-auto rounded-xl" />
                    <Skeleton className="h-16 w-3/4 mr-auto rounded-xl" />
                    <Skeleton className="h-10 w-2/3 ml-auto rounded-xl" />
                  </div>
                ) : messages.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {messages.length > 10 && !showAllMessages && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllMessages(true)}
                        className="text-xs text-muted-foreground w-full bg-white/50 hover:bg-white/80 transition-colors rounded-xl"
                      >
                        Ver mensagens anteriores
                      </Button>
                    )}
                    {[...(showAllMessages ? messages : messages.slice(0, 10))]
                      .reverse()
                      .map((msg) => {
                        const isMe = msg.from_me
                        const time = new Date(msg.timestamp * 1000)

                        let content = msg.content
                        let Icon = null

                        if (msg.message_type === 'image') {
                          content = '[Foto] ' + (content || '')
                          Icon = ImageIcon
                        } else if (msg.message_type === 'video') {
                          content = '[Vídeo] ' + (content || '')
                          Icon = Video
                        } else if (msg.message_type === 'audio') {
                          content = '[Áudio]'
                          Icon = Mic
                        } else if (msg.message_type === 'document') {
                          content = '[Documento] ' + (content || '')
                          Icon = FileText
                        }

                        return (
                          <div
                            key={msg.id}
                            className={cn(
                              'flex w-full relative group cursor-pointer',
                              isMe ? 'justify-end' : 'justify-start',
                            )}
                            onClick={() => {
                              if (contact) {
                                navigate(`/conversas?chat=${contact.jid}`)
                                onClose()
                              }
                            }}
                          >
                            <div
                              className={cn(
                                'flex flex-col max-w-[85%] rounded-2xl px-3 py-2 text-sm relative transition-all group-hover:shadow-md',
                                isMe
                                  ? 'bg-emerald-100/80 text-emerald-950 rounded-tr-sm'
                                  : 'bg-white border border-border/50 text-foreground rounded-tl-sm shadow-sm',
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-1.5 mb-1 opacity-60 text-[10px] font-medium uppercase tracking-wider">
                                <span>{isMe ? 'Você' : msg.push_name || 'Contato'}</span>
                                <span>•</span>
                                <span>{format(time, 'HH:mm')}</span>
                              </div>
                              <div className="flex items-start gap-1.5">
                                {Icon && (
                                  <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
                                )}
                                <p className="line-clamp-3 leading-relaxed whitespace-pre-wrap break-words">
                                  {content}
                                </p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      Nenhuma mensagem recente encontrada.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground font-medium pt-2 pb-6 border-t border-border/50">
              <div className="flex justify-between">
                <span>Adicionado em:</span>
                <span>
                  {contact?.created
                    ? format(new Date(contact.created), "dd 'de' MMM, yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Última atualização:</span>
                <span>
                  {contact?.updated
                    ? format(new Date(contact.updated), "dd 'de' MMM, yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 bg-background/80 backdrop-blur-md border-t border-border/50 flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl h-10"
              onClick={() => {
                if (contact) {
                  navigate(`/conversas?chat=${contact.jid}`)
                  onClose()
                }
              }}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Abrir conversa
            </Button>
            <Button
              className="flex-1 rounded-xl h-10"
              disabled={!isDirty || saving}
              onClick={handleSave}
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl h-9 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Remover do CRM
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Remover do CRM?</AlertDialogTitle>
                <AlertDialogDescription>
                  Você está prestes a remover{' '}
                  <strong>{contact?.contact_name || contact?.push_name || 'este contato'}</strong>{' '}
                  do CRM. Isso não apagará a conversa no WhatsApp, mas removerá o contato do seu
                  funil de vendas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4 gap-2 sm:justify-end">
                <AlertDialogCancel className="rounded-xl mt-0">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-xl bg-destructive hover:bg-destructive/90 text-white"
                  onClick={handleDelete}
                >
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  )
}
