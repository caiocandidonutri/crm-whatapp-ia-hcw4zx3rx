import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppProvider } from '@/stores/useAppStore'
import { AuthProvider, useAuth } from '@/hooks/use-auth'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { PushPermissionBanner } from '@/components/PushPermissionBanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
import Integracoes from './pages/Integracoes'
import Agenda from './pages/Agenda'
import FilaDoDia from './pages/FilaDoDia'
import Revenda from './pages/Revenda'
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
    <span className="contents">
      <Routes>
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <Index />
            </ErrorBoundary>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route
              path="/home"
              element={
                <ErrorBoundary>
                  <Home />
                </ErrorBoundary>
              }
            />
            <Route
              path="/conversas"
              element={
                <ErrorBoundary>
                  <Conversas />
                </ErrorBoundary>
              }
            />
            <Route
              path="/crm"
              element={
                <ErrorBoundary>
                  <CRM />
                </ErrorBoundary>
              }
            />
            <Route
              path="/agenda"
              element={
                <ErrorBoundary>
                  <Agenda />
                </ErrorBoundary>
              }
            />
            <Route
              path="/fila"
              element={
                <ErrorBoundary>
                  <FilaDoDia />
                </ErrorBoundary>
              }
            />
            <Route
              path="/fila-do-dia"
              element={
                <ErrorBoundary>
                  <FilaDoDia />
                </ErrorBoundary>
              }
            />
            <Route
              path="/revenda"
              element={
                <ErrorBoundary>
                  <Revenda />
                </ErrorBoundary>
              }
            />
            <Route
              path="/agentes"
              element={
                <ErrorBoundary>
                  <Agentes />
                </ErrorBoundary>
              }
            />
            <Route
              path="/chat"
              element={
                <ErrorBoundary>
                  <Chat />
                </ErrorBoundary>
              }
            />
            <Route
              path="/tarefas"
              element={
                <ErrorBoundary>
                  <Tarefas />
                </ErrorBoundary>
              }
            />
            <Route
              path="/equipe"
              element={
                <ErrorBoundary>
                  <Equipe />
                </ErrorBoundary>
              }
            />
            <Route
              path="/integracoes"
              element={
                <ErrorBoundary>
                  <Integracoes />
                </ErrorBoundary>
              }
            />{' '}
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
    </span>
  )
}

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <AppRoutes />
          </TooltipProvider>
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  </ErrorBoundary>
)

export default App
