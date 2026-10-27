import { useEffect, useState } from 'react'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { fetchTeam, createMember, removeMember, leaveAccount, type TeamData } from '@/services/team'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LogOut,
  Plus,
  Trash2,
  Users,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  ShieldCheck,
  Search,
  Phone,
  MessageSquare,
  Activity,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, extractFieldErrors } from '@/lib/pocketbase/errors'
import pb from '@/lib/pocketbase/client'

export default function Equipe() {
  const { accountId, role } = useCurrentAccount()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [team, setTeam] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<'owner' | 'member'>('member')
  const [creating, setCreating] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [successOpen, setSuccessOpen] = useState(false)
  const [createdCreds, setCreatedCreds] = useState({ name: '', email: '', password: '' })
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Sub-aba e estados para Auditoria OPS e Busca de Código P-xxxx
  const [opsAuditLogs, setOpsAuditLogs] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [lookupCode, setLookupCode] = useState('')
  const [lookupResult, setLookupResult] = useState<any | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const loadAuditLogs = async () => {
    setLoadingAudit(true)
    try {
      const records = await pb.collection('ops_access_log').getList(1, 50, {
        sort: '-created',
        requestKey: null,
      })
      setOpsAuditLogs(records.items)
    } catch (err) {
      console.warn('Erro ao carregar auditoria ops:', err)
    } finally {
      setLoadingAudit(false)
    }
  }

  const handleLookupPatient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lookupCode.trim()) return
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      const clean = lookupCode.trim().toUpperCase()
      const res = await pb.send<{ schema: string; contact: any }>(
        `/backend/v1/ops/lookup/${clean}`,
        {
          method: 'GET',
        },
      )
      setLookupResult(res.contact)
    } catch (err: any) {
      setLookupError('Código não encontrado ou sem contato correspondente.')
    } finally {
      setLookupLoading(false)
    }
  }

  useEffect(() => {
    if (role === 'owner') {
      loadAuditLogs()
    }
  }, [role])

  // Confirmação de remoção de membro
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  // Confirmação de sair da equipe
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  const loadTeam = async () => {
    if (!accountId) return
    try {
      const data = await fetchTeam()
      setTeam(data)
    } catch (err) {
      toast.error('Erro ao carregar equipe')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeam()
  }, [accountId])

  const generatePassword = () => {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let pass = ''
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setCreatePassword(pass)
  }

  const handleOpenCreate = () => {
    setCreateName('')
    setCreateEmail('')
    setCreateRole('member')
    generatePassword()
    setShowPassword(false)
    setCreateOpen(true)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createEmail || !createPassword) return
    setCreating(true)
    try {
      await createMember({
        name: createName,
        email: createEmail,
        password: createPassword,
        role: createRole,
      })
      setCreatedCreds({
        name: createName,
        email: createEmail,
        password: createPassword,
      })
      setCreateOpen(false)
      setSuccessOpen(true)
      loadTeam()
    } catch (err) {
      const fieldErrors = extractFieldErrors(err)
      if (fieldErrors.email) {
        toast.error(fieldErrors.email)
      } else {
        toast.error('Erro ao criar membro: ' + getErrorMessage(err))
      }
    } finally {
      setCreating(false)
    }
  }

  const handleConfirmRemove = async () => {
    if (!memberToRemove) return
    setIsRemoving(true)
    try {
      await removeMember(memberToRemove)
      toast.success('Membro removido')
      setMemberToRemove(null)
      loadTeam()
    } catch (err) {
      toast.error('Erro ao remover: ' + getErrorMessage(err))
    } finally {
      setIsRemoving(false)
    }
  }

  const handleConfirmLeave = async () => {
    setIsLeaving(true)
    try {
      await leaveAccount()
      toast.success('Você saiu da equipe')
      signOut()
      navigate('/')
    } catch (err) {
      toast.error('Erro ao sair da equipe: ' + getErrorMessage(err))
      setIsLeaving(false)
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
    toast.success('Copiado para a área de transferência')
  }

  const copyFullMessage = () => {
    const loginUrl = window.location.origin
    const text = `Olá${createdCreds.name ? ` ${createdCreds.name}` : ''}, sua conta foi criada!\n\nAcesse: ${loginUrl}\nEmail: ${createdCreds.email}\nSenha: ${createdCreds.password}`
    copyToClipboard(text, 'full')
  }

  const getMemberAvatarUrl = (userId: string, avatar?: string) => {
    if (!avatar) return undefined
    return `${pb.baseUrl}/api/files/users/${userId}/${avatar}`
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">Equipe</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie o acesso à conta {team?.account?.name}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === 'owner' ? (
            <Button onClick={handleOpenCreate} className="shadow-sm">
              <Plus className="w-4 h-4 mr-2" /> Adicionar membro
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setLeaveDialogOpen(true)}>
              <LogOut className="w-4 h-4 mr-2" /> Sair desta equipe
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/20 flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-medium">Membros Ativos</h3>
          </div>
          <div className="divide-y border-t">
            {team?.members && team.members.length > 0 ? (
              team.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={getMemberAvatarUrl(m.user_id, m.avatar)} />
                      <AvatarFallback>
                        {(m.name?.charAt(0) || m.email?.charAt(0) || 'U').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">
                        {m.name || m.email || 'Usuário'}{' '}
                        {m.role === 'owner' && (
                          <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            Admin
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.email || '—'}</p>
                    </div>
                  </div>
                  {role === 'owner' && m.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => setMemberToRemove(m.user_id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhum membro encontrado.
              </div>
            )}
          </div>
        </div>

        {/* Bloco Admin: Identificação Interna de Código P-xxxx e Log de Auditoria OPS */}
        {role === 'owner' && (
          <div className="space-y-6">
            {/* 1. Busca interna de código pseudônimo */}
            <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-5 h-5 text-primary" />
                  <h3 className="font-medium">Identificar Código do Paciente (P-xxxx)</h3>
                </div>
                <span className="text-xs bg-primary/10 text-primary px-2.5 py-0.5 rounded-full font-medium">
                  Acesso Restrito ao Admin
                </span>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Permite ao Dr. Caio e à Fabiana consultar o código pseudonimizado (ex:{' '}
                  <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">P-XXXX</code>) e
                  descobrir qual contato real do CRM está associado, sem expor dados para fora da
                  clínica.
                </p>
                <form onSubmit={handleLookupPatient} className="flex gap-2 max-w-md">
                  <Input
                    placeholder="Ex: P-9A4B"
                    value={lookupCode}
                    onChange={(e) => setLookupCode(e.target.value)}
                    className="font-mono uppercase tracking-wider"
                  />
                  <Button type="submit" disabled={lookupLoading}>
                    {lookupLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4 mr-2" />
                    )}
                    Pesquisar
                  </Button>
                </form>

                {lookupError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                    {lookupError}
                  </div>
                )}

                {lookupResult && (
                  <div className="p-4 bg-muted/40 border rounded-lg space-y-2 mt-4 animate-fade-in-up">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-foreground flex items-center gap-2">
                        {lookupResult.contact_name}
                        {lookupResult.is_patient && (
                          <span className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">
                            Paciente Ativo
                          </span>
                        )}
                      </h4>
                      <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded border">
                        {lookupResult.patient_code}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span>Telefone: {lookupResult.phone || '—'}</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-muted-foreground" />
                        <span>JID: {lookupResult.jid || '—'}</span>
                      </p>
                      <p className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-muted-foreground" />
                        <span>
                          Estágio no Funil:{' '}
                          <span className="capitalize font-medium text-foreground">
                            {lookupResult.stage || 'lead'}
                          </span>
                        </span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Log de Auditoria da API OPS (ops_access_log) */}
            <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
              <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-medium">
                    Auditoria de Acesso à API de Acompanhamento (ops-v1)
                  </h3>
                </div>
                <Button variant="outline" size="sm" onClick={loadAuditLogs} disabled={loadingAudit}>
                  {loadingAudit ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Atualizar
                </Button>
              </div>
              <div className="p-0">
                {opsAuditLogs.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Nenhum acesso registrado até o momento.
                  </div>
                ) : (
                  <div className="divide-y overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="px-4 py-3">Horário</th>
                          <th className="px-4 py-3">Rota</th>
                          <th className="px-4 py-3">Paciente / Código</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {opsAuditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(log.created).toLocaleString('pt-BR')}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs font-medium">{log.route}</td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {log.patient_code ? (
                                <span className="bg-muted px-1.5 py-0.5 rounded border">
                                  {log.patient_code}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  log.status_code === 200
                                    ? 'bg-emerald-500/10 text-emerald-600'
                                    : log.status_code === 401
                                      ? 'bg-rose-500/10 text-rose-600'
                                      : log.status_code === 429
                                        ? 'bg-amber-500/10 text-amber-600'
                                        : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {log.status_code || 200}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                              {log.ip || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmação: remover membro */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(o) => !o && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              O membro perderá acesso imediatamente. Você pode adicioná-lo novamente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmRemove()
              }}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemoving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: sair da equipe */}
      <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair desta equipe?</AlertDialogTitle>
            <AlertDialogDescription>
              Você perderá acesso a todas as conversas, CRM e tarefas desta conta. Para voltar,
              precisará ser convidado novamente pelo administrador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLeaving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmLeave()
              }}
              disabled={isLeaving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLeaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Sair da equipe
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: adicionar membro */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Adicionar Membro</DialogTitle>
              <DialogDescription>
                Crie uma conta para um membro da sua equipe. Eles poderão acessar imediatamente.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome (Opcional)</label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Nome do membro"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">E-mail</label>
                <Input
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="nome@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Senha de Acesso</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="Senha forte"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={generatePassword}
                    title="Gerar nova senha"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nível de acesso</label>
                <Select
                  value={createRole}
                  onValueChange={(v: 'owner' | 'member') => setCreateRole(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Membro (Padrão)</SelectItem>
                    <SelectItem value="owner">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Criar conta
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: credenciais criadas */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Membro criado com sucesso!</DialogTitle>
            <DialogDescription>
              A conta foi criada. Compartilhe estas credenciais de forma segura com o membro da
              equipe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    E-mail
                  </p>
                  <p className="font-medium">{createdCreds.email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(createdCreds.email, 'email')}
                >
                  {copiedField === 'email' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <div className="h-px bg-border/50" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Senha
                  </p>
                  <p className="font-medium font-mono">{createdCreds.password}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(createdCreds.password, 'password')}
                >
                  {copiedField === 'password' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
            <Button className="w-full" variant="outline" onClick={copyFullMessage}>
              {copiedField === 'full' ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-500" /> Mensagem copiada
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" /> Copiar mensagem completa
                </>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setSuccessOpen(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
