import React, { useState } from 'react'
import { Plus, Pencil, Trash2, Tag, Loader2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { toast } from 'sonner'
import { createCategory, updateCategory, deleteCategory } from '@/services/categories'
import { useCategories } from '@/hooks/use-categories'
import type { Category, CategoryColor } from '@/types/models'
import { CATEGORY_COLOR_MAP, CATEGORY_COLORS } from '@/lib/colors'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
}

export function CategoriesSheet({ open, onOpenChange, accountId }: Props) {
  const { user } = useAuth()
  const { categories, loading } = useCategories(accountId)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [formData, setFormData] = useState({ name: '', color: 'blue' as CategoryColor })

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const handleOpenModal = (cat?: Category) => {
    if (cat) {
      setEditingCategory(cat)
      setFormData({ name: cat.name, color: cat.color })
    } else {
      setEditingCategory(null)
      setFormData({ name: '', color: 'blue' })
    }
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !accountId) return
    setIsSaving(true)
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, formData)
        toast.success('Categoria atualizada')
      } else {
        await createCategory({ ...formData, account_id: accountId, created_by: user?.id })
        toast.success('Categoria criada')
      }
      setModalOpen(false)
    } catch (err) {
      toast.error('Erro ao salvar categoria')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteCategory(deleteId)
      toast.success('Categoria removida')
    } catch (err) {
      toast.error('Erro ao remover categoria')
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-border/50 bg-background/95 backdrop-blur-xl z-50">
          <SheetHeader className="p-6 border-b border-border/50 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-primary" />
                  Categorias
                </SheetTitle>
                <SheetDescription className="mt-1">
                  Gerencie as etiquetas para organizar contatos e conversas.
                </SheetDescription>
              </div>
            </div>
            <Button onClick={() => handleOpenModal()} className="w-full mt-4 gap-2 rounded-xl">
              <Plus className="w-4 h-4" /> Nova categoria
            </Button>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-10 px-4 text-muted-foreground flex flex-col items-center">
                  <div className="w-12 h-12 bg-primary/5 rounded-full flex items-center justify-center mb-3">
                    <Tag className="w-6 h-6 text-primary/40" />
                  </div>
                  <p className="text-sm">Nenhuma categoria criada ainda.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      className="group flex items-center justify-between p-3 rounded-xl border border-border/50 bg-white/50 hover:bg-white transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            'w-3.5 h-3.5 rounded-full shrink-0 shadow-sm',
                            CATEGORY_COLOR_MAP[cat.color],
                          )}
                        />
                        <span className="font-medium text-sm truncate">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => handleOpenModal(cat)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(cat.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <Dialog open={modalOpen} onOpenChange={(o) => !isSaving && setModalOpen(o)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{editingCategory ? 'Editar categoria' : 'Nova categoria'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value.substring(0, 50) })
                }
                placeholder="Ex: VIP, Suporte, Vendas"
                maxLength={50}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="grid grid-cols-6 sm:grid-cols-9 gap-2 pt-1">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    disabled={isSaving}
                    className={cn(
                      'w-6 h-6 rounded-full transition-transform outline-none',
                      CATEGORY_COLOR_MAP[color],
                      formData.color === color
                        ? 'ring-2 ring-offset-2 ring-primary scale-110'
                        : 'hover:scale-110',
                    )}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={isSaving}
              className="rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.name.trim() || isSaving}
              className="rounded-xl"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="sm:max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá a categoria do sistema. Contatos e conversas perderão esta
              etiqueta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl mt-0">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
