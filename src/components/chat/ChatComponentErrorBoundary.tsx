import React from 'react'

/**
 * ErrorBoundary leve por-componente para a árvore da /conversas.
 * Um item quebrado (mensagem malformada, mídia sem URL, campo inesperado
 * no registro) não pode derrubar a tela INTEIRA — derrubava o app inteiro
 * no ErrorBoundary da rota. Aqui o fallback é local e discreto.
 */
type Props = {
  /** Nome do bloco protegido, para log: ex. "ChatList", "MessageItem" */
  label: string
  /** Altura mínima do fallback para não colapsar o layout */
  minHeight?: string
  children: React.ReactNode
}

type State = { hasError: boolean }

export default class ChatComponentErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[ChatComponentErrorBoundary:${this.props.label}]`, error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="text-destructive text-xs flex items-center gap-2 p-3 m-1 rounded-lg bg-destructive/5 border border-destructive/20"
          style={this.props.minHeight ? { minHeight: this.props.minHeight } : undefined}
        >
          <span className="truncate">
            Falha ao exibir {this.props.label.toLowerCase()}. Tente recarregar.
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
