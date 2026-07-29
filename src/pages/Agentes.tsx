import { useEffect, useState } from 'react'
import { Bot, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import { AiAgent } from '@/types/models'
import { useAuth } from '@/hooks/use-auth'
import { useCurrentAccount } from '@/hooks/use-current-account'
import { useRealtime } from '@/hooks/use-realtime'
import { getAiAgents, createAiAgent, updateAiAgent, deleteAiAgent } from '@/services/ai_agents'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { AgenteCard } from '@/components/agentes/AgenteCard'
import { AgenteFormDialog } from '@/components/agentes/AgenteFormDialog'

export default function Agentes() {
  const { user } = useAuth()
  const { accountId } = useCurrentAccount()
  const [agents, setAgents] = useState<AiAgent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AiAgent | null>(null)

  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadAgents = async () => {
    try {
      const data = await getAiAgents()
      setAgents(data)
    } catch (err) {
      toast.error('Erro ao carregar agentes', { description: getErrorMessage(err) })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadAgents()
  }, [user])

  useRealtime('ai_agents', () => {
    loadAgents()
  })

  const handleOpenCreate = () => {
    setSelectedAgent(null)
    setIsFormOpen(true)
  }

  const handleOpenEdit = (agent: AiAgent) => {
    setSelectedAgent(agent)
    setIsFormOpen(true)
  }

  const handleOpenDelete = (id: string) => {
    setAgentToDelete(id)
    setIsDeleteOpen(true)
  }

  const handleSubmit = async (values: any) => {
    if (!user || !accountId) return
    try {
      if (selectedAgent) {
        await updateAiAgent(selectedAgent.id, values)
        toast.success('Agente atualizado com sucesso!')
      } else {
        await createAiAgent({ ...values, user_id: user.id, account_id: accountId })
        toast.success('Agente criado com sucesso!')
      }
    } catch (err) {
      toast.error('Erro ao salvar agente', { description: getErrorMessage(err) })
      throw err
    }
  }

  const confirmDelete = async () => {
    if (!agentToDelete) return
    setIsDeleting(true)
    try {
      await deleteAiAgent(agentToDelete)
      toast.success('Agente excluído com sucesso!')
      setIsDeleteOpen(false)
    } catch (err) {
      toast.error('Erro ao excluir agente', { description: getErrorMessage(err) })
    } finally {
      setIsDeleting(false)
      setAgentToDelete(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
            Agentes de IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Crie agentes com Skip AI para responder conversas de forma autônoma e inteligente.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="shadow-sm">
          <Plus className="w-4 h-4 mr-2" /> Novo agente
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[180px] w-full rounded-xl" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed rounded-xl bg-card/50">
          <div className="bg-primary/10 p-4 rounded-full mb-4">
            <Bot className="w-10 h-10 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Nenhum agente ainda</h3>
          <p className="text-muted-foreground max-w-sm mb-6">
            Crie seu primeiro agente de IA para responder mensagens de forma autônoma nas suas
            conversas do WhatsApp.
          </p>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" /> Criar primeiro agente
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <AgenteCard
              key={agent.id}
              agent={agent}
              onEdit={handleOpenEdit}
              onDelete={handleOpenDelete}
            />
          ))}
        </div>
      )}

      <AgenteFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        agent={selectedAgent}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este agente? Essa ação não pode ser desfeita. As
              conversas que utilizam este agente permanecerão intactas, mas com a IA desativada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
