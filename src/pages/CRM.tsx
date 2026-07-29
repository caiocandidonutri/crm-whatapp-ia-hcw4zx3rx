import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  MoreVertical,
  MessageSquare,
  Trash2,
  Users,
  Clock,
  Building2,
  Tag,
  User,
  ChevronDown,
  Check,
  X,
  SlidersHorizontal,
  Settings2,
  List,
  Columns3,
  Workflow,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'

import pb from '@/lib/pocketbase/client'
import { useInstanciaAtiva } from '@/hooks/use-whatsapp'
import { useCrmContatos, formatPhoneBR } from '@/hooks/use-crm'
import { updateCrmContactStage, deleteCrmContact } from '@/services/crm_service'
import { getDisplayName, isInvalidContactName } from '@/lib/whatsapp-mappers'
import { CrmContact } from '@/types/models'
import { CrmContactDetail } from '@/components/crm/CrmContactDetail'
import { CrmCompaniesList } from '@/components/crm/CrmCompaniesList'
import { CrmPipelineBoard } from '@/components/crm/CrmPipelineBoard'
import { PipelineEditorSheet } from '@/components/crm/PipelineEditorSheet'
import { CategoriesSheet } from '@/components/categories/CategoriesSheet'
import { useCategories } from '@/hooks/use-categories'
import { useCrmStages } from '@/hooks/use-crm-stages'
import { stageStyle } from '@/lib/stage-colors'
import { CATEGORY_COLOR_MAP } from '@/lib/colors'
import { useCurrentAccount } from '@/hooks/use-current-account'

const COMPANIES_TAB_ID = 'companies'

type ViewMode = 'lista' | 'pipeline'

export default function CRM() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { instance } = useInstanciaAtiva()
  const { contacts, loading, reload } = useCrmContatos(instance?.instance_name)
  const { accountId } = useCurrentAccount()
  const { categories } = useCategories(accountId || undefined)
  // O CRM é a tela "dona" das etapas → faz o lazy seed das 4 padrão se a
  // conta ainda não tem pipeline.
  const { stages, loading: stagesLoading } = useCrmStages(accountId || undefined, { seed: true })
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false)
  const [isPipelineEditorOpen, setIsPipelineEditorOpen] = useState(false)

  const [viewMode, setViewMode] = useState<ViewMode>('lista')
  const [activeTab, setActiveTab] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState<'todos' | 'meus'>('todos')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const selectedContactId = searchParams.get('contact')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [contactToDelete, setContactToDelete] = useState<CrmContact | null>(null)

  const isCompanies = activeTab === COMPANIES_TAB_ID

  const stageByKey = useMemo(() => {
    const map = new Map<string, (typeof stages)[number]>()
    for (const s of stages) map.set(s.key, s)
    return map
  }, [stages])

  // Abas: "Todos" + uma por etapa (na ordem do pipeline).
  const tabs = useMemo(
    () => [{ id: 'all', label: 'Todos' }, ...stages.map((s) => ({ id: s.key, label: s.label }))],
    [stages],
  )

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchTerm])

  // Filtros comuns (busca + responsável + categorias), sem o filtro de
  // etapa — reutilizado tanto pela lista quanto pelo board.
  const commonFiltered = useMemo(() => {
    return contacts.filter((c) => {
      let matchSearch = true
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase()
        const display = getDisplayName(c.contact_name, c.jid).toLowerCase()
        const name = (c.contact_name || c.push_name || '').toLowerCase()
        const phone = c.phone || ''
        matchSearch = display.includes(s) || name.includes(s) || phone.includes(s)
      }

      const matchMine = ownerFilter === 'todos' || c.assigned_to === pb.authStore.record?.id

      const matchCategories =
        selectedCategoryIds.length === 0 ||
        selectedCategoryIds.every((catId) => c.category_ids?.includes(catId))

      return matchSearch && matchMine && matchCategories
    })
  }, [contacts, debouncedSearch, ownerFilter, selectedCategoryIds])

  const filteredContacts = useMemo(() => {
    if (activeTab === 'all' || isCompanies) return commonFiltered
    return commonFiltered.filter((c) => c.stage === activeTab)
  }, [commonFiltered, activeTab, isCompanies])

  const getStageCount = (stageId: string) => {
    if (stageId === 'all') return contacts.length
    return contacts.filter((c) => c.stage === stageId).length
  }

  const handleStageChange = async (id: string, newStage: string) => {
    try {
      await updateCrmContactStage(id, newStage)
      toast.success('Fase atualizada com sucesso')
    } catch (err) {
      toast.error('Erro ao atualizar fase')
    }
  }

  const handleDelete = async () => {
    if (!contactToDelete) return
    try {
      await deleteCrmContact(contactToDelete.id)
      toast.success('Contato removido do CRM')
      setContactToDelete(null)
    } catch (err) {
      toast.error('Erro ao remover contato')
    }
  }

  const openContact = (id: string) => {
    setSearchParams((prev) => {
      prev.set('contact', id)
      return prev
    })
  }

  const getContactTitle = (c: CrmContact) =>
    !isInvalidContactName(c.contact_name)
      ? c.contact_name!
      : c.push_name && !isInvalidContactName(c.push_name)
        ? c.push_name
        : getDisplayName(undefined, c.jid)

  const formatRelativeTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const diff = Math.floor((new Date().getTime() - d.getTime()) / 1000)
    if (diff < 60) return 'agora'
    if (diff < 3600) return `Há ${Math.floor(diff / 60)}m`
    if (diff < 86400) return `Há ${Math.floor(diff / 3600)}h`
    if (diff < 604800) return `Há ${Math.floor(diff / 86400)}d`
    return d.toLocaleDateString('pt-BR')
  }

  if (!instance?.instance_name) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">Selecione uma instância primeiro.</div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex flex-col gap-1 md:gap-2">
          <h1 className="font-serif text-3xl font-bold text-primary">CRM</h1>
          <p className="text-muted-foreground font-sans text-sm md:text-base max-w-2xl">
            Gerencie seus leads e acompanhe o funil de vendas. Total de {contacts.length} contatos
            registrados.
          </p>
        </div>

        {!isCompanies && (
          <div className="relative w-full md:w-80 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contatos..."
              className="pl-9 rounded-full bg-white/50 backdrop-blur-sm border-border/40 focus-visible:ring-primary/20 h-10 text-sm w-full shadow-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 mt-2">
        <div className="flex overflow-x-auto gap-2 items-center pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {/* Alternador Lista / Pipeline */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-full border border-border/40 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setViewMode('lista')
                if (isCompanies) setActiveTab('all')
              }}
              className={cn(
                'h-7 px-3 rounded-full text-sm font-medium gap-1.5',
                viewMode === 'lista' && !isCompanies
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setViewMode('pipeline')
                setActiveTab('all')
              }}
              className={cn(
                'h-7 px-3 rounded-full text-sm font-medium gap-1.5',
                viewMode === 'pipeline' && !isCompanies
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Columns3 className="w-3.5 h-3.5" />
              Pipeline
            </Button>
          </div>

          {/* Editar pipeline */}
          {!isCompanies && (
            <Button
              variant="outline"
              className="rounded-full h-9 px-4 font-sans font-medium whitespace-nowrap shrink-0 bg-white/50 backdrop-blur-sm hover:bg-white/80 border-border/40"
              onClick={() => setIsPipelineEditorOpen(true)}
            >
              <Workflow className="w-3.5 h-3.5 mr-1.5" />
              Editar pipeline
            </Button>
          )}

          <div className="w-px h-5 bg-border/50 mx-1 shrink-0" />

          {/* Abas de etapa — só na visão Lista (no Pipeline as colunas já
              representam as etapas) */}
          {viewMode === 'lista' &&
            !isCompanies &&
            tabs.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                className={cn(
                  'rounded-full h-9 px-4 font-sans font-medium whitespace-nowrap shrink-0',
                  activeTab === tab.id
                    ? 'shadow-sm'
                    : 'bg-white/50 backdrop-blur-sm hover:bg-white/80 border-border/40',
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <span
                  className={cn(
                    'ml-2 text-[10px] px-1.5 py-0.5 rounded-full',
                    activeTab === tab.id
                      ? 'bg-white/20 text-white'
                      : 'bg-black/5 text-muted-foreground',
                  )}
                >
                  {getStageCount(tab.id)}
                </span>
              </Button>
            ))}

          {viewMode === 'lista' && !isCompanies && (
            <div className="w-px h-5 bg-border/50 mx-1 shrink-0" />
          )}

          {/* Empresas */}
          <Button
            variant={isCompanies ? 'default' : 'outline'}
            className={cn(
              'rounded-full h-9 px-4 font-sans font-medium whitespace-nowrap shrink-0',
              isCompanies
                ? 'shadow-sm'
                : 'bg-white/50 backdrop-blur-sm hover:bg-white/80 border-border/40',
            )}
            onClick={() => setActiveTab(COMPANIES_TAB_ID)}
          >
            <Building2 className="w-3.5 h-3.5 mr-1.5" />
            Empresas
          </Button>

          {!isCompanies && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'rounded-full h-9 px-4 font-sans font-medium whitespace-nowrap shrink-0 bg-white/50 backdrop-blur-sm hover:bg-white/80 border-border/40',
                      ownerFilter === 'meus' && 'border-primary text-primary bg-primary/5',
                    )}
                  >
                    <User className="w-3.5 h-3.5 mr-1.5" />
                    Responsável
                    <ChevronDown className="w-3 h-3 ml-1.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1 rounded-xl" align="start">
                  <div className="flex flex-col">
                    <button
                      className="flex items-center w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted text-left font-medium"
                      onClick={() => setOwnerFilter('todos')}
                    >
                      Todos
                      {ownerFilter === 'todos' && <Check className="w-4 h-4 ml-auto" />}
                    </button>
                    <button
                      className="flex items-center w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted text-left font-medium"
                      onClick={() => setOwnerFilter('meus')}
                    >
                      Meus contatos
                      {ownerFilter === 'meus' && <Check className="w-4 h-4 ml-auto" />}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'rounded-full h-9 px-4 font-sans font-medium whitespace-nowrap shrink-0 bg-white/50 backdrop-blur-sm hover:bg-white/80 border-border/40',
                      selectedCategoryIds.length > 0 && 'border-primary text-primary bg-primary/5',
                    )}
                  >
                    <Tag className="w-3.5 h-3.5 mr-1.5" />
                    Categorias
                    {selectedCategoryIds.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1.5 rounded-full px-1.5 text-[10px] h-4 leading-none bg-primary text-primary-foreground hover:bg-primary"
                      >
                        {selectedCategoryIds.length}
                      </Badge>
                    )}
                    <ChevronDown className="w-3 h-3 ml-1.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-1 rounded-xl" align="start">
                  <div className="flex flex-col max-h-[300px] overflow-y-auto p-1 gap-0.5">
                    {categories.length === 0 ? (
                      <div className="p-3 text-center text-sm text-muted-foreground">
                        Nenhuma categoria
                      </div>
                    ) : (
                      categories.map((cat) => (
                        <button
                          key={cat.id}
                          className="flex items-center w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted text-left"
                          onClick={() => {
                            setSelectedCategoryIds((prev) =>
                              prev.includes(cat.id)
                                ? prev.filter((id) => id !== cat.id)
                                : [...prev, cat.id],
                            )
                          }}
                        >
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full mr-2 shrink-0',
                              CATEGORY_COLOR_MAP[cat.color],
                            )}
                          />
                          <span className="flex-1 truncate">{cat.name}</span>
                          {selectedCategoryIds.includes(cat.id) && (
                            <Check className="w-4 h-4 ml-2 shrink-0" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-1 border-t mt-1">
                    <button
                      className="flex items-center w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted text-left text-muted-foreground font-medium"
                      onClick={() => setIsCategoriesOpen(true)}
                    >
                      <Settings2 className="w-4 h-4 mr-2" />
                      Gerenciar categorias
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>

        {!isCompanies && (ownerFilter !== 'todos' || selectedCategoryIds.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap text-sm animate-in fade-in slide-in-from-top-1">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filtros ativos:
            </span>

            {ownerFilter === 'meus' && (
              <Badge
                variant="secondary"
                className="rounded-md font-normal pr-1.5 bg-white border border-border/40 text-foreground flex items-center gap-1 h-7"
              >
                <User className="w-3 h-3 text-muted-foreground" />
                Meus contatos
                <button
                  onClick={() => setOwnerFilter('todos')}
                  className="ml-0.5 hover:bg-muted rounded-full p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}

            {selectedCategoryIds.map((catId) => {
              const cat = categories.find((c) => c.id === catId)
              if (!cat) return null
              return (
                <Badge
                  key={catId}
                  variant="secondary"
                  className="rounded-md font-normal pr-1.5 bg-white border border-border/40 text-foreground flex items-center gap-1.5 h-7"
                >
                  <div
                    className={cn('w-2 h-2 rounded-full shrink-0', CATEGORY_COLOR_MAP[cat.color])}
                  />
                  <span className="truncate max-w-[150px]">{cat.name}</span>
                  <button
                    onClick={() =>
                      setSelectedCategoryIds((prev) => prev.filter((id) => id !== catId))
                    }
                    className="ml-0.5 hover:bg-muted rounded-full p-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              )
            })}

            <button
              className="text-xs text-muted-foreground hover:text-primary transition-colors ml-1 font-medium"
              onClick={() => {
                setOwnerFilter('todos')
                setSelectedCategoryIds([])
              }}
            >
              Limpar tudo
            </button>
          </div>
        )}
      </div>

      {isCompanies && <CrmCompaniesList />}

      {/* Visão Pipeline (Kanban) */}
      {!isCompanies &&
        viewMode === 'pipeline' &&
        (contacts.length === 0 && !loading ? (
          <Card className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl overflow-hidden">
            <div className="h-[400px] flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-primary/40" />
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mb-2">Seu CRM está vazio</h3>
              <p className="text-muted-foreground font-sans max-w-md text-sm mb-6">
                Vá para as suas conversas e clique em "Adicionar ao CRM" para começar a construir
                seu funil de vendas.
              </p>
              <Button onClick={() => navigate('/conversas')}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Ir para Conversas
              </Button>
            </div>
          </Card>
        ) : (
          <CrmPipelineBoard
            contacts={commonFiltered}
            stages={stages}
            categories={categories}
            loading={loading || stagesLoading}
            getContactTitle={getContactTitle}
            onOpenContact={openContact}
            onAskDelete={setContactToDelete}
          />
        ))}

      {/* Visão Lista */}
      {!isCompanies && viewMode === 'lista' && (
        <Card className="border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl overflow-hidden min-h-[400px]">
          {loading ? (
            <div className="flex flex-col gap-0 divide-y divide-border/30">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="h-[400px] flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-primary/40" />
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mb-2">Seu CRM está vazio</h3>
              <p className="text-muted-foreground font-sans max-w-md text-sm mb-6">
                Vá para as suas conversas e clique em "Adicionar ao CRM" para começar a construir
                seu funil de vendas.
              </p>
              <Button onClick={() => navigate('/conversas')}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Ir para Conversas
              </Button>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="h-[400px] flex flex-col items-center justify-center text-center p-6">
              <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
                <Search className="w-5 h-5 text-muted-foreground" />
              </div>
              <h3 className="font-serif text-lg font-bold text-primary mb-1">Nenhum resultado</h3>
              <p className="text-muted-foreground font-sans text-sm">
                Não encontramos contatos com os filtros atuais.
              </p>
            </div>
          ) : (
            <div className="flex flex-col p-4 space-y-2">
              {filteredContacts.map((contact) => {
                const st = stageByKey.get(contact.stage)
                const stLabel = st?.label || contact.stage
                const stBadge = stageStyle(st?.color).badge

                return (
                  <div
                    key={contact.id}
                    className="bg-white border border-border/60 rounded-xl px-4 py-3 hover:border-primary/40 hover:shadow-sm transition-all group cursor-pointer flex flex-col sm:flex-row sm:items-center gap-4"
                    onClick={() => openContact(contact.id)}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="shrink-0">
                        <Avatar className="h-11 w-11 ring-2 ring-background">
                          <AvatarImage src={contact.avatar_url} />
                          <AvatarFallback className="bg-primary/10 text-primary font-serif font-bold">
                            {getContactTitle(contact).charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-2">
                          <h4 className="font-serif font-bold text-primary text-base truncate">
                            {getContactTitle(contact)}
                          </h4>
                          {contact.category_ids && contact.category_ids.length > 0 && (
                            <div className="flex items-center gap-1 shrink-0">
                              {contact.category_ids.slice(0, 3).map((id) => {
                                const cat = categories.find((c) => c.id === id)
                                if (!cat) return null
                                return (
                                  <Badge
                                    key={cat.id}
                                    variant="secondary"
                                    className={cn(
                                      'text-[10px] px-1.5 py-0 border-0 text-white font-medium leading-tight h-4',
                                      CATEGORY_COLOR_MAP[cat.color],
                                    )}
                                  >
                                    {cat.name}
                                  </Badge>
                                )
                              })}
                              {contact.category_ids.length > 3 && (
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  +{contact.category_ids.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                          <span className="font-mono text-xs">{formatPhoneBR(contact.phone)}</span>
                          {contact.email && (
                            <>
                              <span className="text-muted-foreground/40">·</span>
                              <span className="truncate">{contact.email}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto mt-2 sm:mt-0">
                      <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
                        <Badge
                          variant="secondary"
                          className={cn('text-xs font-medium border-0 w-fit sm:ml-auto', stBadge)}
                        >
                          {stLabel}
                        </Badge>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {contact.expand?.assigned_to && (
                            <div
                              className="flex items-center gap-1.5 bg-black/5 rounded-full pl-1 pr-2 py-0.5"
                              title={`Responsável: ${contact.expand.assigned_to.name || contact.expand.assigned_to.email}`}
                            >
                              <Avatar className="w-4 h-4">
                                <AvatarImage
                                  src={
                                    contact.expand.assigned_to.avatar
                                      ? pb.files.getUrl(
                                          contact.expand.assigned_to,
                                          contact.expand.assigned_to.avatar,
                                          { thumb: '100x100' },
                                        )
                                      : undefined
                                  }
                                />
                                <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                  {contact.expand.assigned_to.name?.charAt(0) ||
                                    contact.expand.assigned_to.email?.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="hidden sm:inline font-medium">
                                {contact.expand.assigned_to.name?.split(' ')[0] ||
                                  contact.expand.assigned_to.email?.split('@')[0]}
                              </span>
                            </div>
                          )}
                          <div
                            className="flex items-center gap-1"
                            title={new Date(contact.updated).toLocaleString('pt-BR')}
                          >
                            <Clock className="w-3 h-3" />
                            {formatRelativeTime(contact.updated)}
                          </div>
                        </div>
                      </div>

                      <div
                        className="shrink-0 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="rounded-full w-8 h-8">
                              <MoreVertical className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
                            <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1.5">
                              Ações
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => navigate(`/conversas?chat=${contact.jid}`)}
                              className="text-sm px-3 py-2 cursor-pointer font-medium"
                            >
                              <MessageSquare className="w-4 h-4 mr-2 text-muted-foreground" />
                              Abrir conversa
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openContact(contact.id)}
                              className="text-sm px-3 py-2 cursor-pointer font-medium"
                            >
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1.5">
                              Alterar fase
                            </DropdownMenuLabel>
                            {stages.map((s) => (
                              <DropdownMenuItem
                                key={s.id}
                                onClick={() => handleStageChange(contact.id, s.key)}
                                className="text-sm px-3 py-2 cursor-pointer font-medium"
                              >
                                <span
                                  className={cn(
                                    'w-2 h-2 rounded-full mr-2',
                                    stageStyle(s.color).dot,
                                  )}
                                />
                                {s.label}
                                {contact.stage === s.key && (
                                  <div className="ml-auto w-2 h-2 rounded-full bg-primary" />
                                )}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setContactToDelete(contact)}
                              className="text-sm px-3 py-2 cursor-pointer font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!contactToDelete} onOpenChange={(o) => !o && setContactToDelete(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Remover do CRM?</DialogTitle>
            <DialogDescription>
              Você está prestes a remover{' '}
              <strong>{contactToDelete && getContactTitle(contactToDelete)}</strong> do CRM. Esta
              ação não apaga a conversa no WhatsApp, mas remove o registro do funil de vendas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end mt-4">
            <Button variant="ghost" onClick={() => setContactToDelete(null)} className="rounded-xl">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} className="rounded-xl">
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CrmContactDetail
        contactId={selectedContactId}
        onClose={() => {
          setSearchParams((prev) => {
            prev.delete('contact')
            return prev
          })
        }}
        onUpdate={reload}
        onDelete={reload}
      />
      {accountId && (
        <CategoriesSheet
          open={isCategoriesOpen}
          onOpenChange={setIsCategoriesOpen}
          accountId={accountId}
        />
      )}
      <PipelineEditorSheet
        open={isPipelineEditorOpen}
        onOpenChange={setIsPipelineEditorOpen}
        stages={stages}
      />
    </div>
  )
}
