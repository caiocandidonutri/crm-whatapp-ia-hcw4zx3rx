import React, { useState, useEffect } from 'react'
import { Plus, ArrowUp, ArrowDown, Trash2, Loader2, GripVertical, Check } from 'lucide-react'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { cn } from '@/lib/utils'
import { CATEGORY_COLORS, CATEGORY_COLOR_MAP } from '@/lib/colors'
import { stageStyle } from '@/lib/stage-colors'
import {
  CrmStage,
  createCrmStage,
  updateCrmStage,
  deleteCrmStage,
  reorderCrmStages,
  countContactsInStage,
  reassignContactsStage,
  slugifyStageKey,
} from '@/services/crm_stages_service'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  stages: CrmStage[]
}

export function PipelineEditorSheet({ open, onOpenChange, stages }: Props) {
  // Cópia local de trabalho: reflete reordenações otimisticamente e
  // ressincroniza quando o realtime atualiza o `stages` do pai.
  const [working, setWorking] = useState<CrmStage[]>(stages)
  useEffect(() => {
    setWorking(stages)
  }, [stages])

  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('violet')
  const [adding, setAdding] = useState(false)

  const [toDelete, setToDelete] = useState<CrmStage | null>(null)
  const [delCount, setDelCount] = useState(0)
  const [delTarget, setDelTarget] = useState('')
  const [deleting, setDeleting] = useState(false)

  const uniqueKey = (label: string) => {
    const base = slugifyStageKey(label)
    const existing = new Set(working.map((s) => s.key))
    let k = base
    let n = 2
    while (existing.has(k)) {
      k = `${base}_${n}`
      n++
    }
    return k
  }

  const handleAdd = async () => {
    const label = newLabel.trim()
    if (!label || adding) return
    setAdding(true)
    try {
      await createCrmStage({
        key: uniqueKey(label),
        label,
        color: newColor,
        position: working.length,
      })
      setNewLabel('')
      toast.success('Etapa criada')
    } catch {
      toast.error('Erro ao criar etapa')
    } finally {
      setAdding(false)
    }
  }

  const handleRename = async (stage: CrmStage, value: string) => {
    const v = value.trim()
    if (!v || v === stage.label) return
    try {
      await updateCrmStage(stage.id, { label: v })
    } catch {
      toast.error('Erro ao renomear etapa')
    }
  }

  const handleColor = async (stage: CrmStage, color: string) => {
    if (color === stage.color) return
    setWorking((prev) => prev.map((s) => (s.id === stage.id ? { ...s, color } : s)))
    try {
      await updateCrmStage(stage.id, { color })
    } catch {
      toast.error('Erro ao mudar a cor')
    }
  }

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= working.length) return
    const arr = [...working]
    const tmp = arr[index]
    arr[index] = arr[j]
    arr[j] = tmp
    setWorking(arr)
    reorderCrmStages(arr.map((s) => s.id)).catch(() => toast.error('Erro ao reordenar'))
  }

  const openDelete = async (stage: CrmStage) => {
    if (working.length <= 1) {
      toast.error('Mantenha ao menos uma etapa no pipeline.')
      return
    }
    setToDelete(stage)
    const first = working.find((s) => s.id !== stage.id)
    setDelTarget(first?.key || '')
    setDelCount(0)
    try {
      setDelCount(await countContactsInStage(stage.key))
    } catch {
      /* mantém 0 */
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      if (delCount > 0 && delTarget) {
        await reassignContactsStage(toDelete.key, delTarget)
      }
      await deleteCrmStage(toDelete.id)
      toast.success('Etapa excluída')
      setToDelete(null)
    } catch {
      toast.error('Erro ao excluir etapa')
    } finally {
      setDeleting(false)
    }
  }

  const otherStages = toDelete ? working.filter((s) => s.id !== toDelete.id) : []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-border/50 bg-background/95 backdrop-blur-xl z-50">
          <SheetHeader className="p-6 border-b border-border/50 shrink-0">
            <SheetTitle className="flex items-center gap-2">Editar pipeline</SheetTitle>
            <SheetDescription className="mt-1">
              Crie, renomeie, recolora e reordene as etapas do seu funil.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-6 space-y-3">
              {working.map((stage, index) => (
                <div
                  key={stage.id}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-border/50 bg-white/60"
                >
                  <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />

                  {/* Cor */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          'w-5 h-5 rounded-full shrink-0 ring-2 ring-offset-1 ring-transparent hover:ring-border transition-all',
                          stageStyle(stage.color).dot,
                        )}
                        aria-label="Mudar cor"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2" align="start">
                      <div className="grid grid-cols-6 gap-1.5">
                        {CATEGORY_COLORS.map((color) => (
                          <button
                            key={color}
                            onClick={() => handleColor(stage, color)}
                            className={cn(
                              'w-6 h-6 rounded-full transition-transform hover:scale-110 flex items-center justify-center',
                              CATEGORY_COLOR_MAP[color],
                            )}
                          >
                            {stage.color === color && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Label editável (uncontrolled: persiste no blur) */}
                  <Input
                    defaultValue={stage.label}
                    maxLength={50}
                    onBlur={(e) => handleRename(stage, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="h-8 flex-1 bg-transparent border-transparent hover:border-border focus-visible:border-border px-2"
                  />

                  {/* Reordenar */}
                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      disabled={index === working.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => openDelete(stage)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Adicionar nova etapa */}
              <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Nova etapa</Label>
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          'w-8 h-8 rounded-lg shrink-0 ring-2 ring-offset-1 ring-transparent hover:ring-border transition-all',
                          stageStyle(newColor).dot,
                        )}
                        aria-label="Cor da nova etapa"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2" align="start">
                      <div className="grid grid-cols-6 gap-1.5">
                        {CATEGORY_COLORS.map((color) => (
                          <button
                            key={color}
                            onClick={() => setNewColor(color)}
                            className={cn(
                              'w-6 h-6 rounded-full transition-transform hover:scale-110 flex items-center justify-center',
                              CATEGORY_COLOR_MAP[color],
                            )}
                          >
                            {newColor === color && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAdd()
                    }}
                    placeholder="Ex.: Qualificado, Proposta..."
                    maxLength={50}
                    disabled={adding}
                    className="h-9 flex-1"
                  />
                  <Button
                    onClick={handleAdd}
                    disabled={!newLabel.trim() || adding}
                    className="h-9 rounded-lg shrink-0"
                  >
                    {adding ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent className="sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir etapa "{toDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {delCount > 0 ? (
                <>
                  Há <strong>{delCount}</strong> contato(s) nesta etapa. Eles serão movidos para
                  outra etapa antes de excluir.
                </>
              ) : (
                'Nenhum contato está nesta etapa. A exclusão é segura.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {delCount > 0 && (
            <div className="space-y-1.5 py-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Mover contatos para
              </Label>
              <Select value={delTarget} onValueChange={setDelTarget}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {otherStages.map((s) => (
                    <SelectItem key={s.id} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <AlertDialogFooter className="mt-2 gap-2 sm:justify-end">
            <AlertDialogCancel className="rounded-xl mt-0" disabled={deleting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleting || (delCount > 0 && !delTarget)}
              className="rounded-xl bg-destructive hover:bg-destructive/90 text-white"
            >
              {deleting ? 'Excluindo...' : 'Excluir etapa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
