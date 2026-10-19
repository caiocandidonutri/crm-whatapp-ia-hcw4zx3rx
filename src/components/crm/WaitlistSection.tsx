import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Users,
  Plus,
  Clock,
  MapPin,
  Phone,
  CheckCircle2,
  XCircle,
  CalendarCheck,
  Search,
  Loader2,
  Trash2,
  MessageSquare,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  listWaitlist,
  createWaitlistEntry,
  updateWaitlistStatus,
  deleteWaitlistEntry,
} from '@/services/waitlist'
import { useRealtime } from '@/hooks/use-realtime'
import { getCrmContacts } from '@/services/crm_service'
import type { WaitlistEntry, WaitlistStatus, CrmContact } from '@/types/models'
import { formatBrazilianDate } from '@/lib/datetime'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { safePbFullList } from '@/lib/pocketbase/resilient'

type WaitlistSectionProps = {
  accountId: string
  onOpenChat?: (jid: string) => void
}

const CIDADES = ['Qualquer', 'Carmo do Rio Claro', 'Alfenas', 'Monte Belo', 'Online'] as const

const TIPOS = ['Consulta', 'Retorno', 'Consultoria', 'Bioimpedância', 'Outro'] as const

export function WaitlistSection({ accountId, onOpenChat }: WaitlistSectionProps) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<WaitlistStatus | 'todos'>('aguardando')
  const [search, setSearch] = useState('')

  // Modal de adição
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [selectedContactId, setSelectedContactId] = useState<string>('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [tipoDesejado, setTipoDesejado] = useState<(typeof TIPOS)[number]>('Consulta')
  const [cidadePreferida, setCidadePreferida] = useState<(typeof CIDADES)[number]>('Qualquer')
  const [periodoPreferido, setPeriodoPreferido] = useState<'manha' | 'tarde' | 'qualquer'>(
    'qualquer',
  )
  const [observacao, setObservacao] = useState('')

  const reload = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const data = await listWaitlist(accountId, statusFilter)
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }, [accountId, statusFilter])

  useEffect(() => {
    reload()
  }, [reload])

  // Realtime
  useRealtime(
    'waitlist',
    () => {
      reload()
    },
    !!accountId,
  )
  // Carregar contatos para autocomplete com safePbFullList resiliente
  useEffect(() => {
    if (!accountId || !isAddOpen) return
    safePbFullList<CrmContact>({
      collection: 'crm_contacts',
      filter: `account_id="${accountId}"`,
      sort: 'contact_name',
      perPage: 200,
      label: 'WaitlistSection:contacts',
    })
      .then((data) => setContacts(data))
      .catch(() => {})
  }, [accountId, isAddOpen])

  const handleSelectContact = (contactId: string) => {
    setSelectedContactId(contactId)
    const found = contacts.find((c) => c.id === contactId)
    if (found) {
      setNome(found.contact_name || found.push_name || '')
      setTelefone(found.phone || found.jid.split('@')[0] || '')
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim() || !telefone.trim()) {
      toast.error('Preencha o nome e o telefone do paciente.')
      return
    }

    setSaving(true)
    try {
      await createWaitlistEntry(accountId, {
        contact_id: selectedContactId || undefined,
        nome: nome.trim(),
        telefone: telefone.trim(),
        tipo_desejado: tipoDesejado,
        cidade_preferida: cidadePreferida,
        periodo_preferido: periodoPreferido,
        observacao: observacao.trim(),
      })
      toast.success('Paciente adicionado à Lista de Espera!')
      setIsAddOpen(false)
      // Limpar form
      setNome('')
      setTelefone('')
      setSelectedContactId('')
      setObservacao('')
      reload()
    } catch (err: any) {
      toast.error('Erro ao adicionar: ' + (err?.message || 'Tente novamente'))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateStatus = async (id: string, newStatus: WaitlistStatus) => {
    try {
      await updateWaitlistStatus(id, newStatus)
      toast.success(
        newStatus === 'avisado'
          ? 'Paciente marcado como avisado!'
          : newStatus === 'agendado'
            ? 'Paciente agendado com sucesso!'
            : 'Status atualizado.',
      )
      reload()
    } catch {
      toast.error('Erro ao atualizar status.')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja remover este paciente da lista de espera?')) return
    try {
      await deleteWaitlistEntry(id)
      toast.success('Paciente removido da fila.')
      reload()
    } catch {
      toast.error('Erro ao remover.')
    }
  }

  const filteredEntries = useMemo(() => {
    const q = search.toLowerCase().trim()
    return entries.filter((e) => {
      if (!q) return true
      return (
        e.nome.toLowerCase().includes(q) ||
        e.telefone.includes(q) ||
        (e.observacao && e.observacao.toLowerCase().includes(q)) ||
        (e.cidade_preferida && e.cidade_preferida.toLowerCase().includes(q))
      )
    })
  }, [entries, search])

  const stats = useMemo(() => {
    return {
      aguardando: entries.filter((e) => e.status === 'aguardando').length,
      avisado: entries.filter((e) => e.status === 'avisado').length,
    }
  }, [entries])

  return (
    <Card className="border-border/60 bg-white/70 shadow-sm rounded-2xl overflow-hidden mt-6">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
                <Users className="w-5 h-5" />
              </div>
              <CardTitle className="text-lg font-bold text-primary">
                Lista de Espera e Encaixes
              </CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm">
              Pacientes aguardando vaga na agenda. Ao cancelar uma consulta ou abrir um horário
              vago, uma tarefa humana é gerada para a Fabiana com o paciente compatível.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => setIsAddOpen(true)} size="sm" className="gap-1.5 shadow-sm">
              <Plus className="w-4 h-4" />
              <span>Adicionar Paciente</span>
            </Button>
          </div>
        </div>

        {/* Filtros e Busca */}
        <div className="pt-3 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-background p-1 rounded-xl border w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setStatusFilter('aguardando')}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                statusFilter === 'aguardando'
                  ? 'bg-amber-500 text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Aguardando ({stats.aguardando})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('avisado')}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                statusFilter === 'avisado'
                  ? 'bg-blue-600 text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Avisados ({stats.avisado})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('todos')}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                statusFilter === 'todos'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Todos
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, fone, cidade..."
              className="h-8 pl-8 pr-3 text-xs bg-background rounded-xl"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {loading && entries.length === 0 ? (
          <div className="text-center py-10 text-xs text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
            Carregando lista de espera...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed rounded-2xl text-muted-foreground space-y-2">
            <Clock className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm font-medium">Nenhum paciente nesta lista de espera.</p>
            <p className="text-xs">
              Quando houver desistência ou cancelamento, pacientes aqui são recomendados para a
              Fabiana.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40 border rounded-2xl overflow-hidden bg-card/60">
            {filteredEntries.map((item, index) => {
              const daysWaiting = Math.max(
                0,
                Math.round((Date.now() - new Date(item.created).getTime()) / (24 * 3600 * 1000)),
              )

              return (
                <div
                  key={item.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted font-bold text-xs text-muted-foreground shrink-0 mt-0.5">
                      #{index + 1}
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-sm text-foreground">{item.nome}</h4>
                        <Badge
                          variant="outline"
                          className={
                            item.status === 'aguardando'
                              ? 'bg-amber-50 text-amber-700 border-amber-300 text-[10px]'
                              : item.status === 'avisado'
                                ? 'bg-blue-50 text-blue-700 border-blue-300 text-[10px]'
                                : item.status === 'agendado'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]'
                                  : 'bg-muted text-muted-foreground text-[10px]'
                          }
                        >
                          {item.status === 'aguardando'
                            ? 'Aguardando vaga'
                            : item.status === 'avisado'
                              ? 'Avisado de vaga'
                              : item.status === 'agendado'
                                ? 'Agendado'
                                : 'Cancelado'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {item.tipo_desejado}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3" />
                          {item.telefone}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {item.cidade_preferida || 'Qualquer cidade'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Turno: {item.periodo_preferido || 'qualquer'}
                        </span>
                        <span>•</span>
                        <span className="text-amber-800 font-medium">
                          Na fila há {daysWaiting === 0 ? 'poucas horas' : `${daysWaiting} dia(s)`}
                        </span>
                      </div>

                      {item.observacao && (
                        <p className="text-xs text-muted-foreground italic bg-muted/40 p-2 rounded-lg mt-1 border border-border/30">
                          &quot;{item.observacao}&quot;
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Ações da Secretária */}
                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    {onOpenChat && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs gap-1 text-muted-foreground hover:text-primary"
                        onClick={() =>
                          onOpenChat(item.telefone.replace(/\D/g, '') + '@s.whatsapp.net')
                        }
                        title="Abrir WhatsApp"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Chat
                      </Button>
                    )}

                    {item.status === 'aguardando' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                        onClick={() => handleUpdateStatus(item.id, 'avisado')}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Marcar Avisado
                      </Button>
                    )}

                    {item.status === 'avisado' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        onClick={() => handleUpdateStatus(item.id, 'agendado')}
                      >
                        <CalendarCheck className="w-3.5 h-3.5" />
                        Confirmar Agendado
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(item.id)}
                      title="Remover da fila"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Modal Adicionar Paciente */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-500" />
                  Adicionar à Lista de Espera / Encaixe
                </DialogTitle>
                <DialogDescription>
                  Cadastre o paciente para ser priorizado quando abrir um slot compatível na agenda.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-3 text-xs sm:text-sm">
                {contacts.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Preencher a partir de paciente do CRM (opcional)</Label>
                    <Select value={selectedContactId} onValueChange={handleSelectContact}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um contato existente..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-56">
                        {contacts.slice(0, 100).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.contact_name || c.push_name || c.phone} ({c.phone || c.jid})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="wl-nome">Nome do Paciente *</Label>
                  <Input
                    id="wl-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Nome completo do paciente"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wl-tel">Telefone WhatsApp *</Label>
                  <Input
                    id="wl-tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(35) 99999-9999"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Tipo Desejado</Label>
                    <Select
                      value={tipoDesejado}
                      onValueChange={(v) => setTipoDesejado(v as (typeof TIPOS)[number])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Período Preferido</Label>
                    <Select
                      value={periodoPreferido}
                      onValueChange={(v) => setPeriodoPreferido(v as any)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualquer">Qualquer Turno</SelectItem>
                        <SelectItem value="manha">Manhã</SelectItem>
                        <SelectItem value="tarde">Tarde</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Unidade / Cidade Preferida</Label>
                  <Select
                    value={cidadePreferida}
                    onValueChange={(v) => setCidadePreferida(v as (typeof CIDADES)[number])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CIDADES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wl-obs">Observações / Flexibilidade de Horário</Label>
                  <Textarea
                    id="wl-obs"
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    rows={2}
                    placeholder="Ex: Pode ir de última hora, prefere quinta à tarde..."
                  />
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAddOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving} className="gap-1.5">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar na Lista de Espera
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
