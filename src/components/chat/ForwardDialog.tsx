import React, { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Search, Loader2, Send } from 'lucide-react'
import { Conversation } from '@/types/models'
import { resolveDisplayName, formatPhoneBR } from '@/lib/phone'
import { encaminharMensagem } from '@/services/whatsapp_service'
import { toast } from 'sonner'

interface ForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instanceName: string
  messageId: string | null
  conversations: Conversation[]
  onSuccess?: () => void
}

export function ForwardDialog({
  open,
  onOpenChange,
  instanceName,
  messageId,
  conversations,
  onSuccess,
}: ForwardDialogProps) {
  const [search, setSearch] = useState('')
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const [forwarding, setForwarding] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations.slice(0, 30)
    return conversations
      .filter((c) => {
        const name = resolveDisplayName(c.contact_name, c.remote_jid).toLowerCase()
        const phone = (c.contact_phone || c.remote_jid || '').toLowerCase()
        return name.includes(q) || phone.includes(q)
      })
      .slice(0, 30)
  }, [conversations, search])

  const handleForward = async () => {
    if (!selectedJid || !messageId || !instanceName) return
    setForwarding(true)
    try {
      await encaminharMensagem(instanceName, selectedJid, messageId)
      toast.success('Mensagem encaminhada com sucesso!')
      onOpenChange(false)
      setSelectedJid(null)
      onSuccess?.()
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao encaminhar mensagem')
    } finally {
      setForwarding(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!forwarding) {
          onOpenChange(v)
          if (!v) setSelectedJid(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
        </DialogHeader>

        <div className="relative my-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-[300px] overflow-y-auto space-y-1 divide-y divide-border/50">
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Nenhuma conversa encontrada
            </div>
          ) : (
            filtered.map((c) => {
              const name = resolveDisplayName(c.contact_name, c.remote_jid)
              const phone = formatPhoneBR(c.contact_phone || c.remote_jid)
              const isSelected = selectedJid === c.remote_jid

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedJid(c.remote_jid)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/60'
                  }`}
                >
                  <Avatar className="h-9 w-9">
                    {c.avatar_url ? <AvatarImage src={c.avatar_url} /> : null}
                    <AvatarFallback>{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{phone}</p>
                  </div>
                  {isSelected && (
                    <span className="text-xs font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10">
                      Selecionado
                    </span>
                  )}
                </div>
              )
            })
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={forwarding}>
            Cancelar
          </Button>
          <Button
            onClick={handleForward}
            disabled={!selectedJid || forwarding}
            className="bg-primary hover:bg-primary/90 text-white"
          >
            {forwarding ? (
              <span className="inline-flex items-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Encaminhando...
              </span>
            ) : (
              <span className="inline-flex items-center">
                <Send className="w-4 h-4 mr-2" />
                Encaminhar
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
