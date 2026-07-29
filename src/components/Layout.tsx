import React, { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { MessageCircle, Search, Menu, X, LogOut } from 'lucide-react'
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

const NAV_LINKS = [
  { name: 'Início', path: '/home' },
  { name: 'Conversas', path: '/conversas' },
  { name: 'CRM', path: '/crm' },
  { name: 'Agentes', path: '/agentes' },
  { name: 'Tarefas', path: '/tarefas' },
  { name: 'Equipe', path: '/equipe' },
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

  return (
    <main className="flex flex-col min-h-screen bg-background relative overflow-x-hidden">
      {/* Background Noise */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] mix-blend-multiply bg-noise z-0" />

      {/* TopNav */}
      <div className="fixed top-0 inset-x-0 z-50 p-4 flex justify-center">
        <nav className="glass-nav w-full max-w-5xl px-4 py-2 flex items-center justify-between transition-all duration-300">
          {/* Logo */}
          <Link to="/home" className="flex items-center gap-2 px-2 shrink-0">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-lg shadow-sm">
              <MessageCircle className="w-5 h-5 fill-current" />
            </div>
            <span className="font-serif font-bold text-lg text-primary tracking-tight">
              Conectado
            </span>
          </Link>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-1 px-4">
            <div className="w-px h-6 bg-border mx-2" />
            {NAV_LINKS.map((link) => {
              const isActive = location.pathname.startsWith(link.path)
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-white shadow-sm text-primary'
                      : 'text-muted-foreground hover:text-primary hover:bg-white/50',
                  )}
                >
                  {link.name}
                </Link>
              )
            })}
            <div className="w-px h-6 bg-border mx-2" />
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-primary rounded-full hidden sm:flex"
            >
              <Search className="w-4 h-4" />
            </Button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-9 w-9 border-2 border-white shadow-sm">
                      <AvatarImage src={avatarUrl} alt={user.name || 'User'} />
                      <AvatarFallback>{user.name?.charAt(0) || 'U'}</AvatarFallback>
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
                    onClick={handleLogout}
                    className="text-destructive focus:bg-destructive focus:text-destructive-foreground cursor-pointer"
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
              className="md:hidden text-primary"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </nav>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm md:hidden pt-24 px-4 flex flex-col gap-4 animate-fade-in-down">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                'p-4 rounded-xl text-lg font-medium transition-colors',
                location.pathname.startsWith(link.path)
                  ? 'bg-white shadow-sm text-primary border border-border'
                  : 'text-muted-foreground',
              )}
            >
              {link.name}
            </Link>
          ))}
          {user && (
            <Button
              variant="destructive"
              className="mt-auto mb-8 w-full py-6 text-lg rounded-xl"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-5 w-5" /> Sair da conta
            </Button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 pt-24 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full z-10">
        <Outlet />
      </div>
    </main>
  )
}
