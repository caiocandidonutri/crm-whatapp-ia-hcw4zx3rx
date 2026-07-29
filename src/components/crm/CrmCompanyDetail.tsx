import React, { useState, useEffect } from 'react'
import { Building2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'

import { CrmCompany, CrmContact } from '@/types/models'
import {
  getCrmCompany,
  updateCrmCompany,
  deleteCrmCompany,
  listContactsByCompany,
} from '@/services/crm_companies_service'
import { formatPhoneBR } from '@/hooks/use-crm'
import { getDisplayName } from '@/lib/whatsapp-mappers'

interface CrmCompanyDetailProps {
  companyId: string | null
  onClose: () => void
  onUpdate: () => void
  onDelete: () => void
}

export function CrmCompanyDetail({
  companyId,
  onClose,
  onUpdate,
  onDelete,
}: CrmCompanyDetailProps) {
  const [company, setCompany] = useState<CrmCompany | null>(null)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [notes, setNotes] = useState('')

  const isDirty =
    company &&
    (name !== company.name ||
      cnpj !== (company.cnpj || '') ||
      website !== (company.website || '') ||
      industry !== (company.industry || '') ||
      notes !== (company.notes || ''))

  useEffect(() => {
    if (!companyId) {
      setCompany(null)
      setContacts([])
      return
    }

    let isMounted = true
    setLoading(true)

    Promise.all([getCrmCompany(companyId), listContactsByCompany(companyId)])
      .then(([compData, contactsData]) => {
        if (!isMounted) return
        setCompany(compData)
        setName(compData.name || '')
        setCnpj(compData.cnpj || '')
        setWebsite(compData.website || '')
        setIndustry(compData.industry || '')
        setNotes(compData.notes || '')
        setContacts(contactsData)
      })
      .catch((err) => {
        console.error(err)
        toast.error('Erro ao carregar empresa')
        if (isMounted) onClose()
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [companyId, onClose])

  const handleSave = async () => {
    if (!company) return
    try {
      setSaving(true)
      await updateCrmCompany(company.id, {
        name,
        cnpj,
        website,
        industry,
        notes,
      })
      toast.success('Empresa atualizada')
      onUpdate()
      setCompany((prev) => (prev ? { ...prev, name, cnpj, website, industry, notes } : null))
    } catch (err) {
      console.error(err)
      toast.error('Erro ao salvar empresa')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!company) return
    try {
      await deleteCrmCompany(company.id)
      toast.success('Empresa removida')
      onDelete()
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Erro ao remover empresa')
    }
  }

  return (
    <Sheet open={!!companyId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-border/50 bg-background/95 backdrop-blur-xl z-50">
        <SheetHeader className="sr-only">
          <SheetTitle>Detalhes da Empresa</SheetTitle>
          <SheetDescription>
            Gerencie as informações da empresa e veja os contatos vinculados.
          </SheetDescription>
        </SheetHeader>

        <div className="p-6 bg-muted/30 border-b border-border/50">
          {loading ? (
            <div className="flex gap-4 items-center">
              <Skeleton className="w-16 h-16 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ) : company ? (
            <div className="flex gap-5 items-start">
              <Avatar className="w-16 h-16 rounded-xl border-2 border-background shadow-sm shrink-0">
                <AvatarImage src={company.logo_url} className="object-cover" />
                <AvatarFallback className="rounded-xl bg-primary/10 text-primary">
                  <Building2 className="w-8 h-8" />
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1.5 pt-1 min-w-0">
                <h2 className="font-serif text-2xl font-bold text-primary tracking-tight truncate">
                  {company.name}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground font-sans">
                  {industry && <span className="truncate max-w-[120px]">{industry}</span>}
                  {industry && website && <span>•</span>}
                  {website && (
                    <a
                      href={website.startsWith('http') ? website : `https://${website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:underline text-primary max-w-[150px]"
                    >
                      {website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="p-6 flex flex-col gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                Informações Gerais
              </h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Nome da empresa
                  </Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 bg-white/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Segmento</Label>
                    <Input
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="Ex: Tecnologia"
                      className="h-9 bg-white/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">CNPJ</Label>
                    <Input
                      value={cnpj}
                      onChange={(e) => setCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="h-9 bg-white/50"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Website</Label>
                  <Input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="www.empresa.com.br"
                    className="h-9 bg-white/50"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                Anotações
              </h3>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes adicionais sobre a empresa..."
                className="min-h-[100px] resize-y bg-white/50"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary uppercase tracking-wider">
                  Contatos Vinculados
                </h3>
                <span className="text-xs text-muted-foreground">{contacts.length}</span>
              </div>

              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ) : contacts.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {contacts.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/40 border border-border/50"
                    >
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarImage src={c.avatar_url} />
                        <AvatarFallback className="bg-primary/5 text-primary text-xs">
                          {(c.contact_name || c.push_name || 'C').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-primary truncate">
                          {getDisplayName(c.contact_name, c.jid)}
                        </div>
                        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                          {c.role && (
                            <span className="font-medium text-foreground/70">{c.role}</span>
                          )}
                          {c.role && c.phone && <span>•</span>}
                          {c.phone && <span>{formatPhoneBR(c.phone)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 flex flex-col items-center justify-center text-center border border-dashed border-border/60 rounded-xl bg-muted/10">
                  <p className="text-sm text-muted-foreground">Nenhum contato vinculado.</p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 bg-background/80 backdrop-blur-md border-t border-border/50 flex flex-col gap-3 shrink-0">
          <Button
            className="w-full rounded-xl h-10"
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl h-9 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Excluir empresa
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir <strong>{company?.name}</strong>? Os contatos
                  vinculados não serão apagados, apenas perderão o vínculo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4 gap-2 sm:justify-end">
                <AlertDialogCancel className="rounded-xl mt-0">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-xl bg-destructive hover:bg-destructive/90 text-white"
                  onClick={handleDelete}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  )
}
