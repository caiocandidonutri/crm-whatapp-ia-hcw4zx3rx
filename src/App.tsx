import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppProvider } from '@/stores/useAppStore'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { Navigate, Outlet } from 'react-router-dom'

import Layout from './components/Layout'
import Index from './pages/Index'
import Home from './pages/Home'
import Conversas from './pages/Conversas'
import CRM from './pages/CRM'
import Agentes from './pages/Agentes'
import Tarefas from './pages/Tarefas'
import Equipe from './pages/Equipe'
import NotFound from './pages/NotFound'

const ProtectedRoute = () => {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/" replace />
  return <Outlet />
}

const App = () => (
  <AuthProvider>
    <AppProvider>
      <BrowserRouter future={{ v7_startTransition: false, v7_relativeSplatPath: false }}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {/* Routes without Global Layout */}
            <Route path="/" element={<Index />} />

            {/* Routes with Global Layout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/home" element={<Home />} />
                <Route path="/conversas" element={<Conversas />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/agentes" element={<Agentes />} />
                <Route path="/tarefas" element={<Tarefas />} />
                <Route path="/equipe" element={<Equipe />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </BrowserRouter>
    </AppProvider>
  </AuthProvider>
)

export default App
