import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import {
  CheckCircle2,
  QrCode,
  Loader2,
  Sparkles,
  Milestone,
  Kanban,
  UsersRound,
  Tags,
  RefreshCcw,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { useQrConnection } from '@/hooks/use-qr-connection'

const signUpSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres'),
})

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
})

const FEATURES = [
  {
    icon: 'whatsapp',
    title: 'Inbox WhatsApp',
    desc: 'Conversas em tempo real com histórico e mídias',
    color: 'text-emerald-400',
    dot: 'bg-emerald-400',
    glow: '0 0 16px rgba(52,211,153,0.6)',
    idleDelay: '0s',
  },
  {
    icon: Sparkles,
    title: 'Agentes de IA',
    desc: 'OpenAI, Claude, Gemini e Skip AI integrados',
    color: 'text-violet-400',
    dot: 'bg-violet-400',
    glow: '0 0 16px rgba(167,139,250,0.6)',
    idleDelay: '0.4s',
  },
  {
    icon: Milestone,
    title: 'CRM integrado',
    desc: 'Pipeline Lead → Atendimento → Cliente',
    color: 'text-sky-400',
    dot: 'bg-sky-400',
    glow: '0 0 16px rgba(56,189,248,0.6)',
    idleDelay: '0.8s',
  },
  {
    icon: Kanban,
    title: 'Tarefas Kanban',
    desc: 'Demandas da equipe com drag & drop',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    glow: '0 0 16px rgba(251,191,36,0.6)',
    idleDelay: '0.2s',
  },
  {
    icon: UsersRound,
    title: 'Multi-usuário',
    desc: 'Equipe inteira no mesmo número',
    color: 'text-teal-400',
    dot: 'bg-teal-400',
    glow: '0 0 16px rgba(45,212,191,0.6)',
    idleDelay: '0.6s',
  },
  {
    icon: Tags,
    title: 'Categorias',
    desc: 'Etiquetas coloridas por conversa',
    color: 'text-rose-400',
    dot: 'bg-rose-400',
    glow: '0 0 16px rgba(251,113,133,0.6)',
    idleDelay: '1s',
  },
]

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export default function Index() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { signIn, signUp, user, loading } = useAuth()

  const [step, setStep] = useState(1)
  const [isLoginMode, setIsLoginMode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [formData, setFormData] = useState({ name: '', email: '', password: '' })

  const glowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!glowRef.current) return
      glowRef.current.style.transform = `translate(${e.clientX - 250}px, ${e.clientY - 250}px)`
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  useEffect(() => {
    if (user && !loading && step === 1) navigate('/home', { replace: true })
  }, [user, loading, step, navigate])

  const handleConnected = React.useCallback(() => setStep(3), [])

  const { qrCodeBase64, isGenerating, pollErrors, generateQrCode } =
    useQrConnection(handleConnected)

  useEffect(() => {
    if (step === 2 && !qrCodeBase64 && !isGenerating && pollErrors === 0) generateQrCode()
  }, [step, qrCodeBase64, isGenerating, pollErrors, generateQrCode])

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      if (isLoginMode) {
        loginSchema.parse(formData)
        const { error } = await signIn(formData.email, formData.password)
        if (error) throw new Error('Credenciais inválidas')
        toast({ title: 'Login realizado!' })
        navigate('/home')
      } else {
        signUpSchema.parse(formData)
        const { error } = await signUp(formData.name, formData.email, formData.password)
        if (error) {
          if (error.status === 400 && error.response?.data?.email?.code === 'validation_not_unique')
            throw new Error('E-mail já está em uso.')
          throw new Error('Erro ao criar conta. Verifique os dados e tente novamente.')
        }
        toast({
          title: 'Cadastro realizado!',
          description: 'Prosseguindo para conexão do WhatsApp.',
        })
        setStep(2)
      }
    } catch (err: any) {
      const message = err instanceof z.ZodError ? err.errors[0].message : err.message
      toast({ title: 'Atenção', description: message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (step === 3) {
      const steps = 4000 / 50
      let cur = 0
      const timer = setInterval(() => {
        cur++
        setSyncProgress(Math.min(100, Math.round((cur / steps) * 100)))
        if (cur >= steps) {
          clearInterval(timer)
          navigate('/home')
        }
      }, 50)
      return () => clearInterval(timer)
    }
  }, [step, navigate])

  return (
    <div className="min-h-screen flex bg-[#021007] overflow-hidden">
      <div
        ref={glowRef}
        className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none z-0 will-change-transform"
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)',
          transition: 'transform 0.12s ease-out',
        }}
      />

      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/3 -left-32 w-[500px] h-[500px] bg-[#1a4a2b] rounded-full mix-blend-screen filter blur-[140px] opacity-30 animate-blob" />
        <div className="absolute bottom-0 right-0 w-[350px] h-[350px] bg-[#10b981] rounded-full mix-blend-screen filter blur-[120px] opacity-8 animate-blob animation-delay-4000" />
      </div>

      {/* LEFT */}
      <div className="relative z-10 hidden lg:flex flex-col justify-between w-[55%] px-14 xl:px-20 py-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-500/10 rounded-xl border border-emerald-400/20 flex items-center justify-center">
            <WhatsAppIcon className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="font-serif font-bold text-xl text-white tracking-tight">Conectado</span>
        </div>

        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-5">
            <h1 className="font-serif text-6xl xl:text-7xl font-bold text-white leading-[1.02] tracking-tight">
              Plataforma completa de atendimento via{' '}
              <span className="text-emerald-400">WhatsApp com IA</span>
            </h1>
            <p className="text-white/45 text-lg leading-relaxed max-w-lg">
              Duplique este template e tenha em minutos um sistema completo de atendimento com IA,
              CRM e gestão de equipe — pronto para usar.
            </p>
          </div>

          <div className="h-px w-full bg-gradient-to-r from-white/12 via-white/5 to-transparent" />

          <div className="grid grid-cols-2 gap-x-10 gap-y-6">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-3.5 group cursor-default"
                style={{
                  opacity: 0,
                  animation: 'fadeInUp 0.5s ease forwards',
                  animationDelay: `${0.1 + i * 0.08}s`,
                }}
              >
                <div
                  className={cn('w-5 h-5 mt-0.5 shrink-0', f.color)}
                  style={{
                    filter: 'drop-shadow(0 0 0px transparent)',
                    transition: 'transform 0.25s ease, filter 0.25s ease',
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLElement).style.filter = `drop-shadow(${f.glow})`
                    ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.25)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLElement).style.filter =
                      'drop-shadow(0 0 0px transparent)'
                    ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
                  }}
                >
                  {f.icon === 'whatsapp' ? (
                    <WhatsAppIcon className="w-5 h-5" />
                  ) : (
                    <f.icon className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn('w-1.5 h-1.5 rounded-full shrink-0', f.dot)}
                      style={{ animation: `pulse 2.5s ease-in-out ${f.idleDelay} infinite` }}
                    />
                    <p className="text-white/85 font-semibold text-sm leading-snug">{f.title}</p>
                  </div>
                  <p className="text-white/35 text-xs leading-relaxed pl-3.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-white/18 text-xs tracking-wide">
          Powered by Skip Cloud · PocketBase · Evolution API
        </p>
      </div>

      {/* RIGHT */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full lg:w-[45%] px-6 lg:px-12 py-10">
        <div className="flex lg:hidden items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-emerald-500/10 rounded-xl border border-emerald-400/20 flex items-center justify-center">
            <WhatsAppIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="font-serif font-bold text-lg text-white">Conectado</span>
        </div>

        <div className="flex lg:hidden gap-2 flex-wrap justify-center mb-6">
          {FEATURES.map((f, i) => (
            <span
              key={i}
              className={cn(
                'flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium',
                f.color,
              )}
            >
              {f.icon === 'whatsapp' ? (
                <WhatsAppIcon className="w-3 h-3" />
              ) : (
                <f.icon className="w-3 h-3" />
              )}
              <span className="text-white/60">{f.title}</span>
            </span>
          ))}
        </div>

        {step > 1 && (
          <div className="flex items-center gap-2 mb-6 w-full max-w-[360px]">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300',
                    step > s
                      ? 'bg-emerald-500 text-white'
                      : step === s
                        ? 'bg-emerald-500 text-white ring-4 ring-emerald-500/20'
                        : 'bg-white/8 text-white/25',
                  )}
                >
                  {step > s ? <CheckCircle2 className="w-3.5 h-3.5" /> : s}
                </div>
                {s < 3 && (
                  <div
                    className={cn(
                      'flex-1 h-px transition-all duration-500',
                      step > s ? 'bg-emerald-500' : 'bg-white/10',
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="w-full max-w-[360px] rounded-2xl border border-white/10 bg-[#0c1f12]/80 backdrop-blur-xl p-8 shadow-2xl shadow-black/60">
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="font-serif text-2xl font-bold text-white">
                  {isLoginMode ? 'Bem-vindo de volta' : 'Criar sua conta'}
                </h2>
                <p className="text-white/40 text-sm mt-1">
                  {isLoginMode ? 'Acesse sua plataforma' : 'Configure em 3 passos rápidos'}
                </p>
              </div>

              {/* dark-inputs: CSS abaixo garante fundo escuro + texto branco em todos os inputs */}
              <form onSubmit={handleStep1Submit} className="flex flex-col gap-4 dark-inputs">
                {!isLoginMode && (
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor="name"
                      className="text-white/60 text-xs font-semibold uppercase tracking-wider"
                    >
                      Nome completo
                    </Label>
                    <Input
                      id="name"
                      placeholder="João Silva"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="border-white/15 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50 h-11 rounded-xl"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="email"
                    className="text-white/60 text-xs font-semibold uppercase tracking-wider"
                  >
                    E-mail
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="joao@empresa.com"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="border-white/15 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50 h-11 rounded-xl"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="password"
                    className="text-white/60 text-xs font-semibold uppercase tracking-wider"
                  >
                    Senha
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="border-white/15 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-500/50 h-11 rounded-xl"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold mt-1 shadow-lg shadow-emerald-900/50 transition-all active:scale-[.98]"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isLoginMode ? (
                    'Entrar'
                  ) : (
                    'Criar conta e continuar →'
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-white/25">
                {isLoginMode ? 'Não tem conta?' : 'Já tem conta?'}{' '}
                <button
                  type="button"
                  onClick={() => setIsLoginMode(!isLoginMode)}
                  className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors"
                >
                  {isLoginMode ? 'Cadastre-se' : 'Fazer login'}
                </button>
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center gap-6">
              <div className="text-center">
                <h2 className="font-serif text-2xl font-bold text-white">Conectar WhatsApp</h2>
                <p className="text-white/40 text-sm mt-1">Abra o app e escaneie o QR Code</p>
              </div>
              <div className="w-52 h-52 bg-white rounded-2xl flex items-center justify-center overflow-hidden shadow-xl shadow-black/50">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <p className="text-xs text-emerald-600 font-medium animate-pulse">Gerando...</p>
                  </div>
                ) : qrCodeBase64 ? (
                  <img
                    src={
                      qrCodeBase64.startsWith('data:')
                        ? qrCodeBase64
                        : `data:image/png;base64,${qrCodeBase64}`
                    }
                    alt="QR Code"
                    className="w-44 h-44 object-contain mix-blend-multiply"
                  />
                ) : pollErrors >= 1 ? (
                  <div className="flex flex-col items-center gap-3 p-4 text-center">
                    <p className="text-sm text-red-500 font-medium">Conexão instável</p>
                    <Button variant="outline" size="sm" onClick={generateQrCode}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : (
                  <QrCode className="w-16 h-16 text-gray-200" />
                )}
              </div>
              <p className="text-center text-xs text-white/30 leading-relaxed">
                No WhatsApp, acesse{' '}
                <span className="text-white/50 font-medium">Aparelhos Conectados</span> e aponte a
                câmera.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center gap-6">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center mx-auto mb-4">
                  <RefreshCcw className="w-6 h-6 text-emerald-400 animate-spin" />
                </div>
                <h2 className="font-serif text-2xl font-bold text-white">Sincronizando</h2>
                <p className="text-white/40 text-sm mt-1">Puxando seu histórico de conversas</p>
              </div>
              <div className="w-full flex flex-col gap-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/40 font-medium">Importando conversas...</span>
                  <span className="text-emerald-400 font-bold tabular-nums">{syncProgress}%</span>
                </div>
                <Progress
                  value={syncProgress}
                  className="h-1.5 bg-white/8 [&>div]:bg-emerald-500 [&>div]:transition-all"
                />
              </div>
              <p className="text-center text-xs text-white/20 leading-relaxed">
                Você será redirecionado automaticamente assim que terminar.
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }

        /* Inputs escuros com texto branco — override confiável via CSS */
        .dark-inputs input {
          background-color: rgba(8, 24, 14, 0.7) !important;
          color: rgba(255, 255, 255, 0.9) !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
        }
        .dark-inputs input::placeholder {
          color: rgba(255, 255, 255, 0.25) !important;
        }
        /* Override do autofill do browser (Chrome/Safari) */
        .dark-inputs input:-webkit-autofill,
        .dark-inputs input:-webkit-autofill:hover,
        .dark-inputs input:-webkit-autofill:focus {
          -webkit-text-fill-color: rgba(255, 255, 255, 0.9) !important;
          -webkit-box-shadow: 0 0 0 1000px #08180e inset !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
    </div>
  )
}
