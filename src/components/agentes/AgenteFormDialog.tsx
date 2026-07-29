import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Save } from 'lucide-react'
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
  FormDescription,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { AiAgent } from '@/types/models'

const formSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  system_prompt: z
    .string()
    .min(10, 'Prompt deve ter pelo menos 10 caracteres')
    .max(8000, 'Máximo de 8000 caracteres'),
})

type FormValues = z.infer<typeof formSchema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AiAgent | null
  onSubmit: (data: FormValues) => Promise<void>
}

export function AgenteFormDialog({ open, onOpenChange, agent, onSubmit }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      system_prompt: '',
    },
  })

  useEffect(() => {
    if (open) {
      if (agent) {
        form.reset({
          name: agent.name,
          system_prompt: agent.system_prompt,
        })
      } else {
        form.reset({
          name: '',
          system_prompt: '',
        })
      }
    }
  }, [open, agent, form])

  const handleSubmit = async (values: FormValues) => {
    setIsSubmitting(true)
    try {
      await onSubmit(values)
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            {agent ? 'Editar Agente' : 'Novo Agente de IA'}
          </DialogTitle>
          <DialogDescription>
            Configure as instruções e persona do agente. Ele é integrado nativamente ao Skip Cloud
            AI.
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
                      {field.value?.length || 0} / 8000
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

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  'Salvando...'
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" /> Salvar
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
