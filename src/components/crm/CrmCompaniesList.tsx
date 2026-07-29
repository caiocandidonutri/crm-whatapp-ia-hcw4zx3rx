import React, { useState, useMemo } from 'react'
import { Building2, Plus, Search, Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCrmEmpresas } from '@/hooks/use-crm-companies'
import { createCrmCompany } from '@/services/crm_companies_service'
import { CrmCompanyDetail } from './CrmCompanyDetail'

/**
 * View principal da tab "Empresas" no CRM. Renderizada quando o user
 * alterna o tab. Lista as empresas do user, oferece busca local e um
 * botão "+ Nova empresa" no canto. Click em uma row abre o drawer
 * CrmCompanyDetail pra editar dados e ver contatos vinculados.
 */
export function CrmCompaniesList() {
  const { companies, loading, reload } = useCrmEmpresas()
  const [openId, setOpenId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.industry || '').toLowerCase().includes(q) ||
        (c.website || '').toLowerCase().includes(q),
    )
  }, [companies, search])

  return (
    <>
      <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center mb-4">
        <div className="relative flex-1 md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, segmento ou site…"
            className="pl-9 rounded-xl bg-white/50 backdrop-blur-sm border-border/40 h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} className="rounded-xl h-10 shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          Nova empresa
        </Button>
      </div>

      <div className="border border-border/40 shadow-sm bg-white/50 backdrop-blur-sm rounded-2xl overflow-hidden min-h-[300px]">
        {loading ? (
          <div className="flex flex-col gap-0 divide-y divide-border/30">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : companies.length === 0 ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 bg-primary/5 rounded-2xl flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-primary/40" />
            </div>
            <h3 className="font-serif text-xl font-bold text-primary mb-2">
              Nenhuma empresa cadastrada
            </h3>
            <p className="text-muted-foreground font-sans max-w-md text-sm mb-6">
              Crie a primeira empresa pra começar a agrupar seus contatos por organização.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Criar primeira empresa
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-[300px] flex flex-col items-center justify-center text-center p-6">
            <Search className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma empresa corresponde à busca.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/30">
            {filtered.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => setOpenId(company.id)}
                className="flex items-center gap-4 p-4 hover:bg-black/5 transition-colors text-left"
              >
                <Avatar className="h-11 w-11 rounded-xl border border-border/50 shrink-0">
                  <AvatarImage src={company.logo_url} className="object-contain" />
                  <AvatarFallback className="rounded-xl bg-primary/5 text-primary">
                    <Building2 className="w-5 h-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h4 className="font-serif font-bold text-primary text-[15px] truncate">
                    {company.name}
                  </h4>
                  <p className="text-sm text-muted-foreground font-sans truncate">
                    {[company.industry, company.website].filter(Boolean).join(' · ') ||
                      'Sem detalhes'}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1 shrink-0">
                  <Users className="w-3 h-3" />
                  Ver contatos
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <CompanyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false)
          reload()
          setOpenId(id)
        }}
      />

      <CrmCompanyDetail
        companyId={openId}
        onClose={() => setOpenId(null)}
        onUpdate={reload}
        onDelete={reload}
      />
    </>
  )
}

/**
 * Dialog de criação rápida de empresa. Pede só o nome (obrigatório),
 * resto fica pra editar no drawer depois.
 */
function CompanyCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const c = await createCrmCompany({ name: trimmed })
      toast.success(`Empresa "${c.name}" criada`)
      setName('')
      onCreated(c.id)
    } catch {
      toast.error('Erro ao criar empresa')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!creating && !o) {
          setName('')
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Nova empresa
          </DialogTitle>
          <DialogDescription>
            Comece criando o nome. Você pode adicionar site, CNPJ, segmento e contatos depois.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Nome
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
            placeholder="Ex.: Atempus"
            autoFocus
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreate()
              }
            }}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-end mt-4">
          <Button
            variant="ghost"
            onClick={() => {
              setName('')
              onClose()
            }}
            disabled={creating}
            className="rounded-xl"
          >
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()} className="rounded-xl">
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Criando…
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Criar empresa
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
