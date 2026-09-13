import { useEffect, useState, useRef } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Save, Loader2, Paperclip, X, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { AiAgent } from '@/types/models'
import { extractFieldErrors } from '@/lib/pocketbase/errors'

const formSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  system_prompt: z
    .string()
    .min(10, 'Prompt deve ter pelo menos 10 caracteres')
    .max(50000, 'Máximo de 50000 caracteres'),
})

type FormValues = z.infer<typeof formSchema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AiAgent | null
  onSubmit: (data: FormValues, newDocuments: File[], keptDocuments: string[]) => Promise<void>
}

export function AgenteFormDialog({ open, onOpenChange, agent, onSubmit }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [removedDocs, setRemovedDocs] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', system_prompt: '' },
  })

  const normalizeDocuments = (docs: unknown): string[] => {
    if (!docs) return []
    if (Array.isArray(docs)) {
      return docs
        .map((d) =>
          typeof d === 'string'
            ? d.trim()
            : typeof d === 'object' && d !== null && 'name' in d
              ? String((d as any).name).trim()
              : String(d).trim(),
        )
        .filter(Boolean)
    }
    if (typeof docs === 'string') {
      const trimmed = docs.trim()
      if (!trimmed) return []
      // Verifica se é uma string JSON (ex: '["doc1.pdf", "doc2.pdf"]')
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          const parsed = JSON.parse(trimmed)
          return normalizeDocuments(parsed)
        } catch {
          // não é JSON válido, prossegue com split por vírgula
        }
      }
      return trimmed
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    }
    if (typeof docs === 'object') {
      try {
        return Object.values(docs)
          .map((d) => String(d).trim())
          .filter(Boolean)
      } catch {
        return []
      }
    }
    return []
  }

  const existingDocs: string[] = normalizeDocuments(agent?.documents)

  useEffect(() => {
    if (open) {
      setNewFiles([])
      setRemovedDocs([])
      if (agent) {
        form.reset({ name: agent.name, system_prompt: agent.system_prompt })
      } else {
        form.reset({ name: '', system_prompt: '' })
      }
    }
  }, [open, agent, form])

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setNewFiles((prev) => [...prev, ...files])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeNewFile = (idx: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const toggleRemoveExisting = (filename: string) => {
    setRemovedDocs((prev) =>
      prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename],
    )
  }

  const handleSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      const kept = existingDocs.filter((d) => !removedDocs.includes(d))
      await onSubmit(values, newFiles, kept)
      onOpenChange(false)
    } catch (err) {
      const fieldErrors = extractFieldErrors(err)
      if (Object.keys(fieldErrors).length > 0) {
        Object.entries(fieldErrors).forEach(([field, message]) => {
          if (field === 'name' || field === 'system_prompt') {
            form.setError(field as 'name' | 'system_prompt', { type: 'server', message })
          }
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const visibleExisting = existingDocs.filter((d) => !removedDocs.includes(d))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            {agent ? 'Editar Agente' : 'Novo Agente de IA'}
          </DialogTitle>
          <DialogDescription>
            Configure as instruções, persona e documentos do agente. Integrado nativamente ao Skip
            Cloud AI.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6 pt-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Agente</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Assistente de Vendas" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="system_prompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between">
                    <span>Prompt do Sistema (Instruções)</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {field.value?.length || 0} / 50000
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Você é um assistente prestativo da empresa..."
                      className="min-h-[250px] resize-y"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3">
              <FormLabel>Documentos do Agente</FormLabel>
              <p className="text-xs text-muted-foreground">
                PDFs, imagens e documentos que a IA pode enviar aos pacientes quando necessário.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                className="hidden"
                onChange={handleAddFiles}
              />

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4 mr-2" />
                Adicionar documento
              </Button>

              {(visibleExisting.length > 0 || newFiles.length > 0) && (
                <div className="space-y-2">
                  {visibleExisting.map((doc) => (
                    <div
                      key={doc}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1">{doc}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => toggleRemoveExisting(doc)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  {newFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
                    >
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeNewFile(idx)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Save className="w-4 h-4" /> Salvar
                  </span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
