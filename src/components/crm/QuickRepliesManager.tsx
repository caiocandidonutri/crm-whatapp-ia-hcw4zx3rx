import { useState } from 'react'
import { Plus, Trash2, Edit2, Zap, Save, Loader2, Hash, GripVertical } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { useQuickReplies } from '@/hooks/use-quick-replies'
import { createQuickReply, updateQuickReply, deleteQuickReply } from '@/services/quick_replies'
import type { QuickReply } from '@/types/models'
import { toast } from 'sonner'

type QuickRepliesManagerProps = {
  accountId: string
}

const CATEGORIES = [
  { value: 'valores', label: 'Valores e Pagamento' },
  { value: 'local', label: 'Unidades e Locais' },
  { value: 'preparo', label: 'Preparo de Exames / Bioimpedância' },
  { value: 'agendamento', label: 'Agendamentos e Confirmações' },
  { value: 'geral', label: 'Geral / Boas-vindas' },
]

export function QuickRepliesManager({ accountId }: QuickRepliesManagerProps) {
  const { replies, loading, reload } = useQuickReplies(accountId)
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  // Form states
  const [title, setTitle] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [category, setCategory] = useState('geral')
  const [body, setBody] = useState('')
  const [sortOrder, setSortOrder] = useState<number>(0)

  const handleOpenCreate = () => {
    setEditingReply(null)
    setTitle('')
    setShortcut('')
    setCategory('geral')
    setBody('')
    setSortOrder(replies.length + 1)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (r: QuickReply) => {
    setEditingReply(r)
    setTitle(r.title)
    setShortcut(r.shortcut || '')
    setCategory(r.category || 'geral')
    setBody(r.body)
    setSortOrder(r.sort_order ?? 0)
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      toast.error('Título e mensagem são obrigatórios.')
      return
    }

    setIsSaving(true)
    try {
      const cleanShortcut = shortcut.trim()
        ? shortcut.trim().startsWith('/')
          ? shortcut.trim()
          : '/' + shortcut.trim()
        : ''
      if (editingReply) {
        await updateQuickReply(editingReply.id, {
          title: title.trim(),
          shortcut: cleanShortcut,
          category,
          body: body.trim(),
          sort_order: Number(sortOrder) || 0,
        })
        toast.success('Resposta rápida atualizada com sucesso!')
      } else {
        await createQuickReply(accountId, {
          title: title.trim(),
          shortcut: cleanShortcut,
          category,
          body: body.trim(),
          sort_order: Number(sortOrder) || 0,
        })
        toast.success('Resposta rápida criada!')
      }
      setIsModalOpen(false)
      reload()
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err?.message || 'Tente novamente'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este template de resposta?')) return
    setIsDeleting(id)
    try {
      await deleteQuickReply(id)
      toast.success('Resposta excluída.')
      reload()
    } catch {
      toast.error('Erro ao excluir resposta rápida.')
    } finally {
      setIsDeleting(null)
    }
  }

  return (
    <Card className="border-border/60 bg-white/70 shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="border-b bg-muted/20 pb-4 flex flex-row items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
              <Zap className="w-5 h-5 fill-amber-500/20" />
            </div>
            <CardTitle className="text-lg font-bold text-primary">
              Respostas Rápidas (Templates da Fabiana)
            </CardTitle>
          </div>
          <CardDescription className="text-xs sm:text-sm">
            Templates pré-configurados (valores, locais, preparo de bioimpedância) que podem ser
            inseridos no chat com 1 clique ou pelo atalho &quot;/&quot;.
          </CardDescription>
        </div>
        <Button onClick={handleOpenCreate} size="sm" className="gap-1.5 shadow-sm">
          <Plus className="w-4 h-4" />
          <span>Novo Template</span>
        </Button>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {loading && replies.length === 0 ? (
          <div className="text-center py-10 text-xs text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
            Carregando respostas rápidas...
          </div>
        ) : replies.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed rounded-2xl text-muted-foreground space-y-3">
            <Zap className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm">Nenhum template salvo no momento.</p>
            <Button onClick={handleOpenCreate} variant="outline" size="sm">
              Criar o primeiro template
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {replies.map((reply) => (
              <div
                key={reply.id}
                className="p-4 rounded-xl border bg-card/60 hover:bg-card hover:shadow-sm transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <h4 className="font-semibold text-sm text-foreground">{reply.title}</h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        {reply.shortcut && (
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px] h-4 px-1.5 bg-amber-50 text-amber-800 border-amber-200"
                          >
                            <Hash className="w-2.5 h-2.5 mr-0.5" />
                            {reply.shortcut.replace(/^\//, '')}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">
                          {reply.category || 'geral'}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => handleOpenEdit(reply)}
                        title="Editar template"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(reply.id)}
                        disabled={isDeleting === reply.id}
                        title="Excluir template"
                      >
                        {isDeleting === reply.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap leading-relaxed">
                    {reply.body}
                  </p>
                </div>

                <div className="text-[10px] text-muted-foreground/70 flex items-center justify-between pt-2 border-t border-border/30">
                  <span>Ordem: #{reply.sort_order ?? 0}</span>
                  <span>1 clique no chat</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de Criação / Edição */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleSave}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
                  {editingReply ? 'Editar Resposta Rápida' : 'Novo Template de Resposta'}
                </DialogTitle>
                <DialogDescription>
                  Configure o texto acolhedor da secretária humana Fabiana e o atalho no chat.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4 text-xs sm:text-sm">
                <div className="space-y-1.5">
                  <Label htmlFor="qr-title">Título de identificação *</Label>
                  <Input
                    id="qr-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Valores e Formas de Pagamento"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="qr-shortcut">Atalho no chat</Label>
                    <Input
                      id="qr-shortcut"
                      value={shortcut}
                      onChange={(e) => setShortcut(e.target.value)}
                      placeholder="/valores"
                      className="font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">Ex: /valores, /local</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qr-category">Categoria</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger id="qr-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qr-order">Ordem de exibição</Label>
                    <Input
                      id="qr-order"
                      type="number"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qr-body">Mensagem completa (Tom da Fabiana) *</Label>
                  <Textarea
                    id="qr-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    placeholder="Olá! A consulta com o Dr. Caio inclui avaliação clínica..."
                    className="leading-relaxed"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Ao clicar no chat, este texto é colocado na caixa para você ler e ajustar antes
                    de enviar.
                  </p>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving} className="gap-1.5">
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{editingReply ? 'Salvar Alterações' : 'Criar Template'}</span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
