import React, { useState, useEffect } from 'react'
import { UserPlus, Loader2, Mail, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import pb from '@/lib/pocketbase/client'
import { CrmCompany } from '@/types/models'
import { adicionarContatoDoChat } from '@/services/crm_service'
import { CompanyAutocomplete } from './CompanyAutocomplete'
import { isInvalidContactName } from '@/lib/whatsapp-mappers'
import { useTeamMembers } from '@/hooks/use-team-members'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CategoryPicker } from '@/components/categories/CategoryPicker'
import { useCategories } from '@/hooks/use-categories'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useCrmStages } from '@/hooks/use-crm-stages'
import { DEFAULT_STAGES } from '@/services/crm_stages_service'

// Regex para detectar emails em texto livre. Conservadora — permite
// caracteres comuns mas exige domínio com TLD de 2+ chars.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

type Props = {
  open: boolean
  onClose: () => void
  instance_name: string
  remote_jid: string
  /** Nome inicial do contato (ex.: chat.name). Pode ser número formatado
   *  se a conv não tem nome real — nesse caso o dialog mostra placeholder
   *  pra incentivar o user a digitar o nome certo na hora. */
  initialName?: string
  /** Chamado após o contato ser criado com sucesso. */
  onAdded?: () => void
}

/**
 * Dialog de pré-validação ao adicionar um contato no CRM.
 */
export function AddToCrmDialog({
  open,
  onClose,
  instance_name,
  remote_jid,
  initialName,
  onAdded,
}: Props) {
  const cleanInitial = (raw?: string) => {
    if (!raw) return ''
    if (raw.startsWith('+')) return ''
    if (isInvalidContactName(raw)) return ''
    return raw
  }

  const [name, setName] = useState(cleanInitial(initialName))
  const [stage, setStage] = useState<string>('lead')
  const [company, setCompany] = useState<CrmCompany | null>(null)
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [emailDetected, setEmailDetected] = useState(false)
  const [assignedTo, setAssignedTo] = useState('unassigned')
  const [creating, setCreating] = useState(false)
  const { members, loading: loadingMembers } = useTeamMembers()
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const { account } = useCurrentAccount()
  const { categories } = useCategories(account?.id)
  const { stages } = useCrmStages(account?.id)
  // Fallback pras etapas padrão se a conta ainda não tem pipeline carregado
  // (ex.: abriu o dialog antes de visitar o CRM). Os keys batem com o seed.
  const stageOptions = stages.length > 0 ? stages : DEFAULT_STAGES

  useEffect(() => {
    if (!open) return
    setName(cleanInitial(initialName))
    setStage('lead')
    setCompany(null)
    setRole('')
    setEmail('')
    setEmailDetected(false)
    setAssignedTo(pb.authStore.record?.id || 'unassigned')
    setCategoryIds([])
  }, [open, initialName])

  useEffect(() => {
    if (!open || !instance_name || !remote_jid) return
    let cancelled = false

    pb.collection('whatsapp_messages')
      .getList(1, 50, {
        filter: `instance_name = "${instance_name}" && remote_jid = "${remote_jid}" && content != ""`,
        sort: '-timestamp',
      })
      .then((res) => {
        if (cancelled) return
        for (const m of res.items) {
          const content = (m as { content?: string }).content || ''
          const found = content.match(EMAIL_REGEX)
          if (found) {
            setEmail((current) => {
              if (current) return current
              setEmailDetected(true)
              return found[0]
            })
            return
          }
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [open, instance_name, remote_jid])

  const handleSubmit = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await adicionarContatoDoChat(instance_name, remote_jid, {
        contact_name: name.trim() || undefined,
        stage: stage as any,
        company_id: company?.id,
        role: role.trim() || undefined,
        email: email.trim() || undefined,
        assigned_to: assignedTo === 'unassigned' ? undefined : assignedTo,
        category_ids: categoryIds.length > 0 ? categoryIds : undefined,
      })

      if (res.record?.id) {
        const payloadAssignedTo = assignedTo === 'unassigned' ? '' : assignedTo
        if (res.record.assigned_to !== payloadAssignedTo) {
          try {
            await pb
              .collection('crm_contacts')
              .update(res.record.id, { assigned_to: payloadAssignedTo }, { requestKey: null })
          } catch (e) {
            console.error('Failed to update assigned_to', e)
          }
        }
      }

      if (res.isAlreadyAdded) {
        toast.info('Esse contato já está no CRM')
      } else {
        toast.success('Adicionado ao CRM')
      }
      onAdded?.()
      onClose()
    } catch {
      toast.error('Erro ao adicionar ao CRM')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Adicionar ao CRM
          </DialogTitle>
          <DialogDescription>
            Revise os dados antes de adicionar. Dá pra editar tudo depois no detalhe do contato.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Nome do contato</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
              placeholder="Ex.: João Silva"
              autoFocus
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Empresa <span className="text-muted-foreground/60">(opcional)</span>
            </Label>
            <CompanyAutocomplete
              selectedCompany={company}
              onChange={(c) => setCompany(c)}
              disabled={creating}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Cargo</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={creating}
                placeholder="Product Manager"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Mail className="w-3 h-3" />
                Email
              </Label>
              <Input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailDetected(false)
                }}
                disabled={creating}
                type="email"
                placeholder="joao@empresa.com"
                maxLength={200}
              />
            </div>
          </div>

          {emailDetected && email && (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1 -mt-2">
              <Sparkles className="w-3 h-3" />
              Email encontrado no histórico de mensagens
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Responsável</Label>
            <Select
              value={assignedTo}
              onValueChange={setAssignedTo}
              disabled={creating || loadingMembers}
            >
              <SelectTrigger>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 flex flex-col">
              <Label className="text-xs font-medium text-muted-foreground">Categorias</Label>
              <CategoryPicker
                categories={categories}
                selectedIds={categoryIds}
                onChange={setCategoryIds}
                disabled={creating}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Estágio inicial</Label>
              <Select value={stage} onValueChange={setStage} disabled={creating}>
                <SelectTrigger>
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
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-end mt-4">
          <Button variant="ghost" onClick={onClose} disabled={creating} className="rounded-xl">
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={creating} className="rounded-xl">
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adicionando…
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Adicionar ao CRM
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
