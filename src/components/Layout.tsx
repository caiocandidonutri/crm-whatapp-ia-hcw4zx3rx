import React, { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  MessageCircle,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Home,
  MessageSquare,
  ListTodo,
  UserPlus,
  Calendar,
  CheckSquare,
  TrendingUp,
  Workflow,
  ShieldCheck,
  Bot,
  Users,
  Brain,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import pb from '@/lib/pocketbase/client'
import { DisconnectBanner } from '@/components/DisconnectBanner'
import { RealtimeStatusIndicator } from '@/components/RealtimeStatusIndicator'
import { NotificationCenter } from '@/components/NotificationCenter'

export interface NavItem {
  name: string
  path: string
  subtitle: string
  icon: React.ElementType
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Atendimento',
    items: [
      {
        name: 'Conversas',
        path: '/conversas',
        subtitle: 'Inbox WhatsApp da clínica',
        icon: MessageSquare,
      },
      {
        name: 'Fila do Dia',
        path: '/fila',
        subtitle: 'Quem precisa de contato hoje',
        icon: ListTodo,
      },
    ],
  },
  {
    group: 'Pacientes',
    items: [
      {
        name: 'CRM',
        path: '/crm',
        subtitle: 'Histórico completo de cada paciente',
        icon: UserPlus,
      },
      {
        name: 'Agenda',
        path: '/agenda',
        subtitle: 'Consultas e conciliação do dia',
        icon: Calendar,
      },
      {
        name: 'Tarefas',
        path: '/tarefas',
        subtitle: 'Demandas e follow-ups da equipe',
        icon: CheckSquare,
      },
    ],
  },
  {
    group: 'Crescimento',
    items: [
      {
        name: 'Revenda',
        path: '/revenda',
        subtitle: 'Priorize quem está mais perto de fechar',
        icon: TrendingUp,
      },
      {
        name: 'Réguas',
        path: '/integracoes',
        subtitle: 'Automações e réguas pós-consulta',
        icon: Workflow,
      },
    ],
  },
  {
    group: 'Sistema',
    items: [
      {
        name: 'Memória da Clínica',
        path: '/memoria',
        subtitle: 'Base de conhecimento e fichas da Fabiana',
        icon: Brain,
      },
      {
        name: 'Repertório Fabiana',
        path: '/repertorio',
        subtitle: 'Análise de voz e modelos aprovados',
        icon: Bot,
      },
      {
        name: 'Recepção',
        path: '/recepcao',
        subtitle: 'Checklist e rotinas operacionais',
        icon: ShieldCheck,
      },
      {
        name: 'Agentes IA',
        path: '/agentes',
        subtitle: 'Inteligência artificial e respostas',
        icon: Bot,
      },
      {
        name: 'Equipe',
        path: '/equipe',
        subtitle: 'Membros e permissões da clínica',
        icon: Users,
      },
    ],
  },
]

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = () => {
    signOut()
    navigate('/')
  }

  const avatarUrl = user?.avatar
    ? pb.files.getUrl(user, user.avatar, { thumb: '100x100' })
    : undefined

  const isHomeActive = location.pathname === '/home'

  return (
    <main className="flex flex-col h-screen bg-slate-50/60 relative overflow-x-hidden">
      {/* Background Noise */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] mix-blend-multiply bg-noise z-0" />

      {/* TopNav */}
      <div className="fixed top-0 inset-x-0 z-50 p-3 sm:p-4 flex justify-center">
        <nav className="glass-nav w-full max-w-6xl px-3 sm:px-4 py-2 flex items-center justify-between transition-all duration-300 border border-border/50 bg-white/80 backdrop-blur-md rounded-2xl shadow-xs">
          {/* Logo */}
          <Link to="/home" className="flex items-center gap-2 px-2 shrink-0 group">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-xl shadow-xs group-hover:scale-105 transition-transform">
              <MessageCircle className="w-5 h-5 fill-current" />
            </div>
            <div className="flex flex-col">
              <span className="font-serif font-bold text-base sm:text-lg text-primary tracking-tight leading-none">
                Conectado
              </span>
              <span className="text-[10px] text-muted-foreground font-sans leading-tight hidden sm:inline">
                CRM Clínico
              </span>
            </div>
          </Link>

          {/* Desktop Links organizados por BLOCOS com Dropdown informativo */}
          <div className="hidden lg:flex items-center gap-1">
            <Link
              to="/home"
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 flex items-center gap-1.5',
                isHomeActive
                  ? 'bg-primary/10 text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-primary hover:bg-slate-100/70',
              )}
            >
              <Home className="w-3.5 h-3.5" />
              Início
            </Link>

            <div className="w-px h-4 bg-border/60 mx-1" />

            {NAV_GROUPS.map((group) => {
              const isGroupActive = group.items.some((item) =>
                location.pathname.startsWith(item.path),
              )
              const activeItem = group.items.find((item) => location.pathname.startsWith(item.path))

              return (
                <DropdownMenu key={group.group}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 flex items-center gap-1 cursor-pointer outline-hidden',
                        isGroupActive
                          ? 'bg-primary/10 text-primary shadow-xs'
                          : 'text-muted-foreground hover:text-primary hover:bg-slate-100/70',
                      )}
                    >
                      <span>{group.group}</span>
                      {activeItem && (
                        <span className="text-[10px] opacity-70">({activeItem.name})</span>
                      )}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-72 p-2 rounded-2xl shadow-lg border-border/60 bg-white/95 backdrop-blur-md"
                  >
                    <DropdownMenuLabel className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground px-2 py-1">
                      {group.group}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="my-1 bg-border/40" />
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const isItemActive = location.pathname.startsWith(item.path)
                      return (
                        <DropdownMenuItem
                          key={item.path}
                          asChild
                          className="p-0 focus:bg-transparent"
                        >
                          <Link
                            to={item.path}
                            className={cn(
                              'flex items-start gap-2.5 p-2 rounded-xl transition-colors cursor-pointer w-full',
                              isItemActive
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-slate-100/80 text-foreground',
                            )}
                          >
                            <div
                              className={cn(
                                'p-1.5 rounded-lg shrink-0 mt-0.5',
                                isItemActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-slate-100 text-muted-foreground',
                              )}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-semibold leading-tight">
                                {item.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                {item.subtitle}
                              </span>
                            </div>
                          </Link>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            })}
          </div>

          {/* Quick link bar for medium screens (md to lg) */}
          <div className="hidden md:flex lg:hidden items-center gap-1">
            <Link
              to="/home"
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium',
                isHomeActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
              )}
            >
              Início
            </Link>
            <Link
              to="/conversas"
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium',
                location.pathname.startsWith('/conversas')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground',
              )}
            >
              Conversas
            </Link>
            <Link
              to="/crm"
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium',
                location.pathname.startsWith('/crm')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground',
              )}
            >
              CRM
            </Link>
            <Link
              to="/fila"
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium',
                location.pathname.startsWith('/fila')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground',
              )}
            >
              Fila
            </Link>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <RealtimeStatusIndicator />
            <NotificationCenter />

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                    <Avatar className="h-8 w-8 border border-border/60 shadow-2xs">
                      <AvatarImage src={avatarUrl} alt={user.name || 'User'} />
                      <AvatarFallback className="text-xs font-bold text-primary bg-primary/5">
                        {user.name?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.name}</p>
                      <p className="text-xs leading-none text-muted-foreground truncate">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => navigate('/recepcao')}
                    className="cursor-pointer text-xs"
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    <span>Checklist Recepção</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => navigate('/equipe')}
                    className="cursor-pointer text-xs"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    <span>Gerenciar Equipe</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive focus:bg-destructive focus:text-destructive-foreground cursor-pointer text-xs"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sair</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {/* Mobile Menu Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-primary h-9 w-9"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </nav>
      </div>

      {/* Mobile Menu Overlay com BLOCOS explicativos */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-md lg:hidden pt-20 px-4 pb-6 flex flex-col gap-4 overflow-y-auto animate-fade-in-down">
          <Link
            to="/home"
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              'p-3 rounded-xl text-sm font-semibold transition-colors flex items-center gap-3 border',
              isHomeActive
                ? 'bg-primary/10 text-primary border-primary/20'
                : 'text-foreground bg-white border-border/50',
            )}
          >
            <Home className="w-4 h-4 text-primary" />
            <div className="flex flex-col">
              <span>Início</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                Painel de Comando e resumo do dia
              </span>
            </div>
          </Link>

          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2">
                {group.group}
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isItemActive = location.pathname.startsWith(item.path)
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'p-2.5 rounded-xl text-sm font-medium transition-colors flex items-start gap-3 border',
                        isItemActive
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-white text-foreground border-border/40 hover:border-border',
                      )}
                    >
                      <div className="p-1 rounded-lg bg-slate-100 text-muted-foreground shrink-0 mt-0.5">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold leading-tight">{item.name}</span>
                        <span className="text-[11px] text-muted-foreground leading-snug">
                          {item.subtitle}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}

          {user && (
            <Button
              variant="outline"
              className="mt-2 w-full py-5 text-sm rounded-xl text-destructive border-destructive/20 hover:bg-destructive/5"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sair da conta
            </Button>
          )}
        </div>
      )}

      {/* Global Disconnect Banner */}
      <DisconnectBanner />

      <div className="pt-20" />

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 pt-4 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full z-10 overflow-y-auto">
        <Outlet />
      </div>
    </main>
  )
}
