import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppProvider } from '@/stores/useAppStore'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { PushPermissionBanner } from '@/components/PushPermissionBanner'
import { Navigate, Outlet } from 'react-router-dom'

import Layout from './components/Layout'
import Index from './pages/Index'
import Home from './pages/Home'
import Conversas from './pages/Conversas'
import CRM from './pages/CRM'
import Agentes from './pages/Agentes'
import Chat from './pages/Chat'
import Tarefas from './pages/Tarefas'
import Equipe from './pages/Equipe'
import NotFound from './pages/NotFound'

const ProtectedRoute = () => {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/" replace />
  return <Outlet />
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()
  const { showBanner, requestPermission, dismissBanner } = usePushNotifications(isAuthenticated)

  return (
    <>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/conversas" element={<Conversas />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/agentes" element={<Agentes />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/tarefas" element={<Tarefas />} />
            <Route path="/equipe" element={<Equipe />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      {isAuthenticated && (
        <PushPermissionBanner
          show={showBanner}
          onAccept={requestPermission}
          onDismiss={dismissBanner}
        />
      )}
    </>
  )
}

const App = () => (
  <AuthProvider>
    <AppProvider>
      <BrowserRouter future={{ v7_startTransition: false, v7_relativeSplatPath: false }}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AppRoutes />
        </TooltipProvider>
      </BrowserRouter>
    </AppProvider>
  </AuthProvider>
)

export default App
