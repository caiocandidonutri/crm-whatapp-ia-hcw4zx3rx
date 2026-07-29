import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, MessageSquare, Trash2, Phone, Users, Building2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import pb from '@/lib/pocketbase/client'
import { CrmContact, Category } from '@/types/models'
import { CrmStage } from '@/services/crm_stages_service'
import { stageStyle } from '@/lib/stage-colors'
import { CATEGORY_COLOR_MAP } from '@/lib/colors'
import { formatPhoneBR } from '@/hooks/use-crm'
import { updateCrmContactStage } from '@/services/crm_service'
import { toast } from 'sonner'

function relativeTime(dateStr: string) {
  const d = new Date(dateStr)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return d.toLocaleDateString('pt-BR')
}

interface CrmPipelineBoardProps {
  contacts: CrmContact[]
  stages: CrmStage[]
  categories: Category[]
  loading: boolean
  getContactTitle: (c: CrmContact) => string
  onOpenContact: (id: string) => void
  onAskDelete: (c: CrmContact) => void
}

export function CrmPipelineBoard({
  contacts,
  stages,
  categories,
  loading,
  getContactTitle,
  onOpenContact,
  onAskDelete,
}: CrmPipelineBoardProps) {
  const navigate = useNavigate()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const moveTo = async (id: string, stageKey: string) => {
    const c = contacts.find((x) => x.id === id)
    if (!c || c.stage === stageKey) return
    try {
      await updateCrmContactStage(id, stageKey)
    } catch {
      toast.error('Erro ao mover contato')
    }
  }

  const handleDrop = async (e: React.DragEvent, stageKey: string) => {
    e.preventDefault()
    setDragOverCol(null)
    setDraggedId(null)
    const id = e.dataTransfer.getData('crmContactId')
    if (id) moveTo(id, stageKey)
  }

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-80 shrink-0 rounded-2xl bg-muted/30 border p-3">
            <Skeleton className="h-6 w-32 mb-4" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:h-2">
      <div className="flex gap-4 min-w-max items-start">
        {stages.map((stage) => {
          const style = stageStyle(stage.color)
          const stageContacts = contacts.filter((c) => c.stage === stage.key)
          const isDragOver = dragOverCol === stage.key

          return (
            <div
              key={stage.id}
              className={cn(
                'w-80 shrink-0 flex flex-col rounded-2xl border bg-muted/20 transition-all duration-200 min-h-[400px]',
                isDragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border/40',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverCol(stage.key)
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => handleDrop(e, stage.key)}
            >
              <div
                className={cn(
                  'flex items-center justify-between px-4 py-3 border-b border-border/40 rounded-t-2xl backdrop-blur-sm',
                  style.accent,
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-sm text-foreground min-w-0">
                  <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', style.dot)} />
                  <span className="truncate">{stage.label}</span>
                </div>
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-white text-gray-700 text-xs font-bold border border-black/10 shadow-sm shrink-0">
                  {stageContacts.length}
                </span>
              </div>

              <div className="p-3 flex flex-col gap-3 flex-1">
                {stageContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/60 text-sm border-2 border-dashed border-border/40 rounded-xl">
                    <Users className="w-5 h-5" />
                    Nenhum contato
                  </div>
                ) : (
                  stageContacts.map((contact) => {
                    const company = contact.expand?.company_id
                    const assigned = contact.expand?.assigned_to
                    return (
                      <div
                        key={contact.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('crmContactId', contact.id)
                          setDraggedId(contact.id)
                        }}
                        onDragEnd={() => setDraggedId(null)}
                        onClick={() => onOpenContact(contact.id)}
                        className={cn(
                          'group bg-white border border-border/60 rounded-xl p-3.5 shadow-sm cursor-grab active:cursor-grabbing hover:border-primary/40 hover:shadow-md transition-all',
                          draggedId === contact.id && 'opacity-50 border-dashed',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="h-10 w-10 ring-2 ring-background shrink-0">
                            <AvatarImage src={contact.avatar_url} />
                            <AvatarFallback className="bg-primary/10 text-primary font-serif font-bold text-sm">
                              {getContactTitle(contact).charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <h4 className="font-serif font-bold text-primary text-sm leading-tight truncate">
                                {getContactTitle(contact)}
                              </h4>
                              <div
                                className="shrink-0 -mt-1 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 rounded-full"
                                    >
                                      <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="w-48 rounded-xl p-1.5"
                                  >
                                    <DropdownMenuItem
                                      onClick={() => navigate(`/conversas?chat=${contact.jid}`)}
                                      className="text-sm px-3 py-2 cursor-pointer font-medium"
                                    >
                                      <MessageSquare className="w-4 h-4 mr-2 text-muted-foreground" />
                                      Abrir conversa
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1.5">
                                      Mover para
                                    </DropdownMenuLabel>
                                    {stages.map((s) => (
                                      <DropdownMenuItem
                                        key={s.id}
                                        onClick={() => moveTo(contact.id, s.key)}
                                        disabled={contact.stage === s.key}
                                        className="text-sm px-3 py-2 cursor-pointer font-medium"
                                      >
                                        <span
                                          className={cn(
                                            'w-2 h-2 rounded-full mr-2',
                                            stageStyle(s.color).dot,
                                          )}
                                        />
                                        {s.label}
                                        {contact.stage === s.key && (
                                          <span className="ml-auto text-[10px] text-muted-foreground">
                                            atual
                                          </span>
                                        )}
                                      </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => onAskDelete(contact)}
                                      className="text-sm px-3 py-2 cursor-pointer font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Excluir
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>

                            {contact.role && (
                              <p className="text-xs text-muted-foreground truncate leading-tight">
                                {contact.role}
                              </p>
                            )}

                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                              <Phone className="w-3 h-3 shrink-0" />
                              <span className="font-mono truncate">
                                {formatPhoneBR(contact.phone)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {company && (
                          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-foreground/80 bg-muted/60 rounded-md px-2 py-1 w-fit max-w-full">
                            <Building2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{company.name}</span>
                          </div>
                        )}

                        {contact.category_ids && contact.category_ids.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-2.5">
                            {contact.category_ids.slice(0, 3).map((id) => {
                              const cat = categories.find((c) => c.id === id)
                              if (!cat) return null
                              return (
                                <Badge
                                  key={cat.id}
                                  variant="secondary"
                                  className={cn(
                                    'text-[10px] px-1.5 py-0 border-0 text-white font-medium leading-tight h-4',
                                    CATEGORY_COLOR_MAP[cat.color],
                                  )}
                                >
                                  {cat.name}
                                </Badge>
                              )
                            })}
                            {contact.category_ids.length > 3 && (
                              <span className="text-[10px] text-muted-foreground font-medium">
                                +{contact.category_ids.length - 3}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/40 text-[11px] text-muted-foreground">
                          {assigned ? (
                            <div
                              className="flex items-center gap-1.5 min-w-0"
                              title={`Responsável: ${assigned.name || assigned.email}`}
                            >
                              <Avatar className="w-5 h-5">
                                <AvatarImage
                                  src={
                                    assigned.avatar
                                      ? pb.files.getUrl(assigned, assigned.avatar, {
                                          thumb: '100x100',
                                        })
                                      : undefined
                                  }
                                />
                                <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                  {assigned.name?.charAt(0) || assigned.email?.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium truncate max-w-[110px] text-foreground/70">
                                {assigned.name?.split(' ')[0] || assigned.email?.split('@')[0]}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/50 italic">Sem responsável</span>
                          )}
                          <span
                            className="shrink-0"
                            title={new Date(contact.updated).toLocaleString('pt-BR')}
                          >
                            {relativeTime(contact.updated)}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
