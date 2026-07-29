import React, { useState, useEffect } from 'react'
import { Bot, BotOff, Loader2, Settings2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { getAiAgents } from '@/services/ai_agents'
import { atualizarConversaAi } from '@/services/whatsapp_service'
import { useRealtime } from '@/hooks/use-realtime'
import type { AiAgent } from '@/types/models'

type Props = {
  chat: any
  isMobile: boolean
}

export function AgenteConversaToggle({ chat, isMobile }: Props) {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AiAgent[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [saving, setSaving] = useState(false)

  const aiAgentId = chat?.ai_agent_id
  const aiEnabled = chat?.ai_enabled

  const fetchAgents = async () => {
    setLoadingAgents(true)
    try {
      const data = await getAiAgents()
      setAgents(data)
      setFetched(true)
    } catch (err) {
      toast.error('Erro ao carregar agentes')
    } finally {
      setLoadingAgents(false)
    }
  }

  useEffect(() => {
    if (open && !fetched) {
      fetchAgents()
    }
  }, [open, fetched])

  useRealtime<AiAgent>(
    'ai_agents',
    (e) => {
      if (!open) return
      if (e.action === 'create') {
        setAgents((prev) => [...prev, e.record].sort((a, b) => a.name.localeCompare(b.name)))
      } else if (e.action === 'update') {
        setAgents((prev) =>
          prev
            .map((a) => (a.id === e.record.id ? e.record : a))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      } else if (e.action === 'delete') {
        setAgents((prev) => prev.filter((a) => a.id !== e.record.id))
      }
    },
    open,
  )

  const activeAgent = agents.find((a) => a.id === aiAgentId)
  const agentDeleted = aiAgentId && fetched && !activeAgent && !loadingAgents

  const handleLink = async (agentId: string) => {
    setSaving(true)
    try {
      await atualizarConversaAi(chat.id, agentId, true)
      toast.success('Agente ativado para esta conversa')
    } catch (err) {
      toast.error('Erro ao ativar agente')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (checked: boolean) => {
    if (!aiAgentId) return
    setSaving(true)
    try {
      await atualizarConversaAi(chat.id, aiAgentId, checked)
      toast.success(checked ? 'Resposta automática ativada' : 'Resposta automática pausada')
    } catch (err) {
      toast.error('Erro ao alterar status do agente')
    } finally {
      setSaving(false)
    }
  }

  const handleUnlink = async () => {
    setSaving(true)
    try {
      await atualizarConversaAi(chat.id, null, false)
      toast.success('Agente desvinculado')
      if (agentDeleted) {
        setOpen(false)
      }
    } catch (err) {
      toast.error('Erro ao desvincular agente')
    } finally {
      setSaving(false)
    }
  }

  const renderTrigger = () => {
    if (!aiAgentId) {
      return (
        <Button
          variant="ghost"
          size={isMobile ? 'icon' : 'default'}
          className={cn(
            'rounded-full text-muted-foreground hover:text-primary transition-colors',
            !isMobile && 'gap-2',
          )}
        >
          <Bot className="w-5 h-5" />
          {!isMobile && <span>Ativar IA</span>}
        </Button>
      )
    }

    if (aiEnabled) {
      return (
        <Button
          variant="default"
          size={isMobile ? 'icon' : 'default'}
          className={cn(
            'rounded-full bg-[#0a7c52] hover:bg-[#0a7c52]/90 text-white shadow-sm',
            !isMobile && 'gap-2',
          )}
        >
          <Bot className="w-5 h-5" />
          {!isMobile && (
            <span className="truncate max-w-[120px]">{activeAgent?.name || 'Agente'}</span>
          )}
        </Button>
      )
    }

    return (
      <Button
        variant="secondary"
        size={isMobile ? 'icon' : 'default'}
        className={cn('rounded-full text-muted-foreground', !isMobile && 'gap-2')}
      >
        <BotOff className="w-5 h-5" />
        {!isMobile && (
          <span className="truncate max-w-[120px]">{activeAgent?.name || 'Agente'}</span>
        )}
      </Button>
    )
  }

  if (chat?.is_group || chat?.remote_jid?.endsWith('@g.us')) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTrigger()}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 overflow-hidden shadow-lg border-border">
        {loadingAgents && !fetched ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : agentDeleted ? (
          <div className="p-4 space-y-3 bg-white">
            <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-sm font-medium border border-destructive/20">
              O agente vinculado a esta conversa não existe mais.
            </div>
            <Button
              variant="outline"
              className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
              onClick={handleUnlink}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Limpar referência
            </Button>
          </div>
        ) : aiAgentId && activeAgent ? (
          <div className="flex flex-col bg-white">
            <div className="p-4 bg-muted/30 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <Bot className="w-5 h-5 text-primary shrink-0" />
                <h4 className="font-semibold text-sm truncate" title={activeAgent.name}>
                  {activeAgent.name}
                </h4>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase font-semibold px-2 py-0 border bg-emerald-100 text-emerald-800 border-emerald-200"
                >
                  Skip Cloud AI
                </Badge>
                <span className="text-[11px] text-muted-foreground truncate">Agent</span>
              </div>
            </div>

            <div className="p-4 border-b border-border space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm font-medium">Responder automaticamente</span>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    O agente assumirá esta conversa.
                  </p>
                </div>
                <Switch
                  checked={aiEnabled}
                  onCheckedChange={handleToggleEnabled}
                  disabled={saving}
                />
              </div>
            </div>

            {agents.length > 1 && (
              <div className="p-4 border-b border-border space-y-3">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Trocar agente
                </span>
                <div className="grid gap-1">
                  {agents
                    .filter((a) => a.id !== activeAgent.id)
                    .map((agent) => (
                      <Button
                        key={agent.id}
                        variant="ghost"
                        size="sm"
                        className="justify-start font-normal text-sm hover:bg-primary/5 hover:text-primary"
                        onClick={() => handleLink(agent.id)}
                        disabled={saving}
                      >
                        <Bot className="w-4 h-4 mr-2 opacity-50 shrink-0" />
                        <span className="truncate flex-1 text-left">{agent.name}</span>
                      </Button>
                    ))}
                </div>
              </div>
            )}

            <div className="p-2 bg-muted/10">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 justify-start"
                onClick={handleUnlink}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <BotOff className="w-4 h-4 mr-2" />
                )}
                Desvincular agente desta conversa
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4 bg-white">
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Ativar Inteligência Artificial</h4>
              <p className="text-xs text-muted-foreground">
                Selecione um agente para responder automaticamente a esta conversa.
              </p>
            </div>

            {agents.length === 0 ? (
              <div className="text-center py-5 px-4 space-y-3 bg-muted/50 rounded-lg border border-border border-dashed">
                <span className="text-sm text-muted-foreground block">Nenhum agente criado.</span>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/agentes">
                    <Settings2 className="w-4 h-4 mr-2" />
                    Criar um agente
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-1.5 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                {agents.map((agent) => (
                  <Button
                    key={agent.id}
                    variant="outline"
                    className="justify-start text-sm font-normal h-auto py-2 px-3 hover:border-primary/50 hover:bg-primary/5"
                    onClick={() => handleLink(agent.id)}
                    disabled={saving}
                  >
                    <Bot className="w-5 h-5 mr-3 shrink-0 text-primary" />
                    <div className="flex flex-col items-start min-w-0 flex-1 gap-1">
                      <span className="truncate w-full font-medium leading-none">{agent.name}</span>
                      <span className="text-[10px] text-muted-foreground truncate w-full leading-none">
                        Skip Cloud AI
                      </span>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
