import React, { useState, useEffect } from 'react'
import {
  X,
  User,
  Phone,
  Calendar,
  HeartPulse,
  Tag,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { CrmContact, Task } from '@/types/models'
import pb from '@/lib/pocketbase/client'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { getCareCategoryMeta, getPriorityMeta, getStatusMeta } from '@/lib/task-meta'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface PatientContextPanelProps {
  open: boolean
  onClose: () => void
  remoteJid: string
  contactName?: string
  instanceName?: string
  onOpenAddToCrm?: () => void
}

export function PatientContextPanel({
  open,
  onClose,
  remoteJid,
  contactName,
  instanceName,
  onOpenAddToCrm,
}: PatientContextPanelProps) {
  const [loading, setLoading] = useState(false)
  const [contact, setContact] = useState<CrmContact | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    if (!open || !remoteJid) return

    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      try {
        const cleanPhone = remoteJid.split('@')[0]
        // Buscar contato no CRM
        const contacts = await pb.collection('crm_contacts').getFullList<CrmContact>({
          filter: `jid = "${remoteJid}" || phone ~ "${cleanPhone}"`,
          expand: 'stage_id,company_id',
          sort: '-created',
        })

        if (cancelled) return

        if (contacts.length > 0) {
          const c = contacts[0]
          setContact(c)

          // Buscar tarefas vinculadas ao contato
          try {
            const taskList = await pb.collection('tasks').getFullList<Task>({
              filter: `crm_contact_id = "${c.id}"`,
              sort: '-created',
            })
            if (!cancelled) setTasks(taskList)
          } catch {
            /* intentionally ignored */
          }
        } else {
          setContact(null)
          setTasks([])
        }
      } catch (err) {
        if (!cancelled) setContact(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
  }, [open, remoteJid, instanceName])

  if (!open) return null

  const displayName = resolveDisplayName(
    contact?.contact_name || contactName,
    contact?.jid || remoteJid,
    contact?.push_name,
  )
  const displayPhone = formatPhoneBR(contact?.phone || remoteJid)

  const careMeta = contact?.care_status ? getCareCategoryMeta(contact.care_status) : null

  return (
    <aside className="fixed inset-0 md:static md:inset-auto md:w-80 w-full bg-white flex flex-col h-full z-50 md:z-20 border-l border-border shadow-lg md:shadow-sm shrink-0 animate-in slide-in-from-right duration-200">
      {/* Cabeçalho do Painel */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-white shrink-0 min-h-[56px]">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-rose-600" />
          <h3 className="font-semibold text-foreground text-sm md:text-base">
            Contexto do Paciente
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-10 w-10 min-h-[44px] min-w-[44px] rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Fechar contexto do paciente"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs">Carregando dados do CRM...</span>
          </div>
        ) : !contact ? (
          <div className="text-center py-8 px-2 space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <User className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">{displayName}</p>
              <p className="text-xs text-muted-foreground">{displayPhone}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Este paciente ainda não está cadastrado na base do CRM.
            </p>
            {onOpenAddToCrm && (
              <Button
                size="sm"
                onClick={onOpenAddToCrm}
                className="w-full min-h-[44px] bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Adicionar ao CRM
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Informações Básicas do Paciente */}
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border">
                {contact.avatar ? (
                  <AvatarImage src={pb.files.getUrl(contact, contact.avatar)} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {displayName.charAt(0).toUpperCase() || 'P'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-base leading-tight truncate">{displayName}</h4>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" />
                  {displayPhone}
                </p>
              </div>
            </div>

            <Separator />

            {/* Estágio do Pipeline & Cuidado */}
            <div className="space-y-2.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Status no CRM
              </span>
              <div className="flex flex-wrap gap-2">
                {contact.expand?.stage_id ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-medium bg-primary/5 text-primary border-primary/20"
                  >
                    <Tag className="w-3 h-3 mr-1" />
                    {contact.expand.stage_id.label ||
                      contact.expand.stage_id.title ||
                      contact.stage}
                  </Badge>
                ) : contact.stage ? (
                  <Badge
                    variant="outline"
                    className="text-xs font-medium bg-primary/5 text-primary border-primary/20"
                  >
                    <Tag className="w-3 h-3 mr-1" />
                    {contact.stage}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Sem estágio definido
                  </Badge>
                )}

                {careMeta && (
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium border-transparent ${careMeta.color}`}
                  >
                    <span className="mr-1">{careMeta.emoji}</span>
                    {careMeta.label}
                  </Badge>
                )}
              </div>
            </div>

            {/* Data da Última Conversão / Consulta */}
            {contact.converted_at && (
              <div className="p-3 rounded-lg bg-muted/40 border text-xs space-y-1">
                <span className="text-muted-foreground flex items-center gap-1 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  Data de Conversão:
                </span>
                <p className="font-semibold text-foreground">
                  {format(new Date(contact.converted_at), "dd 'de' MMMM 'de' yyyy", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            )}

            {/* Sugestão da IA */}
            {contact.ai_suggested_action && (
              <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-xs space-y-1">
                <span className="text-purple-800 flex items-center gap-1 font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  Ação Sugerida pela IA:
                </span>
                <p className="text-purple-900 leading-relaxed">{contact.ai_suggested_action}</p>
              </div>
            )}

            <Separator />

            {/* Tarefas Vinculadas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tarefas ({tasks.length})
                </span>
              </div>
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  Nenhuma tarefa vinculada a este paciente.
                </p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => {
                    const statusMeta = getStatusMeta(task.status)
                    const prioMeta = getPriorityMeta(task.priority)
                    return (
                      <div
                        key={task.id}
                        className="p-2.5 rounded-lg border bg-background hover:bg-muted/40 transition-colors text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground line-clamp-1">
                            {task.title}
                          </span>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dot}`} />
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{prioMeta.label}</span>
                          <span>•</span>
                          <span>{statusMeta.label}</span>
                          {task.due_date && (
                            <>
                              <span>•</span>
                              <span>Venc: {format(new Date(task.due_date), 'dd/MM')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
