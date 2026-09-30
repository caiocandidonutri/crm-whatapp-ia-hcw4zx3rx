import React, { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log do erro de renderização para diagnóstico
    console.error('[ErrorBoundary] Erro capturado na árvore de componentes:', error, errorInfo)
  }

  handleReload = () => {
    if (this.props.onReset) {
      this.props.onReset()
    }
    window.location.reload()
  }

  handleGoHome = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/home'
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-muted/20 font-sans">
          <div className="max-w-md w-full bg-card rounded-2xl border border-border/80 shadow-elevation p-6 sm:p-8 text-center flex flex-col items-center gap-4 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200/60 flex items-center justify-center shadow-sm">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-primary tracking-tight">
                Algo deu errado
              </h1>
              <p className="text-sm text-muted-foreground text-balance">
                Ocorreu uma instabilidade inesperada na exibição desta tela. Seus dados estão
                seguros no sistema.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="w-full text-left bg-muted/50 p-3 rounded-xl border border-border/50 text-[11px] font-mono text-muted-foreground break-words overflow-auto max-h-32">
                {this.state.error.message}
                {this.state.error.stack && (
                  <pre className="mt-2 text-[10px] text-muted-foreground/80 whitespace-pre-wrap font-mono">
                    {this.state.error.stack.split('\n').slice(0, 5).join('\n')}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 w-full mt-2">
              <Button
                onClick={this.handleReload}
                className="w-full sm:flex-1 rounded-xl min-h-[44px] gap-2 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Recarregar
              </Button>
              <Button
                variant="outline"
                onClick={this.handleGoHome}
                className="w-full sm:flex-1 rounded-xl min-h-[44px] gap-2 border-border/60"
              >
                <Home className="w-4 h-4" />
                Ir para o Início
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
