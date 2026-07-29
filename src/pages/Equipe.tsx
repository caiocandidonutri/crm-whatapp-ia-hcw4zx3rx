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
            {team?.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={getMemberAvatarUrl(m.user_id, m.avatar)} />
                    <AvatarFallback>{m.name?.charAt(0) || 'U'}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-sm">
                      {m.name || m.email}{' '}
                      {m.role === 'owner' && (
                        <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
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
            ))}
          </div>
        </div>
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
