/**
 * Configuração e Algoritmo de Score de Interesse de Revenda (0–100)
 * Fase 4 do Contrato Dr. Caio.
 *
 * NOTA DE CONTRATO (MENTOR / DR. CAIO):
 * Todos os pesos dos componentes e limites/critérios de segmentação estão centralizados
 * neste arquivo (REVENDA_SCORE_WEIGHTS, REVENDA_SEGMENT_CONFIGS e THRESHOLDS) para que o Mentor
 * possa ajustar as minutas e a calibragem sem necessitar de refatoração de código.
 *
 * Somatória dos pesos máximos: EXATAMENTE 100 pontos.
 * - Recência: 30 pts
 * - Frequência: 25 pts
 * - Engajamento: 20 pts
 * - Posição / Valor: 15 pts
 * - Gatilhos: 10 pts
 *
 * LGPD estrita: Apenas metadados agregados e temporais são processados. Nenhum texto de conversa.
 */

import type { CrmContact, Conversation, Task } from '@/types/models'
import { parseToDate } from '@/lib/datetime'

export type RevendaSegmentKey =
  | 'retomada'
  | 'fechamento'
  | 'renovacao'
  | 'novo_servico'
  | 'reativacao'

export interface RevendaScoreWeights {
  recencia: number // default: 30
  frequencia: number // default: 25
  engajamento: number // default: 20
  posicaoValor: number // default: 15
  gatilhos: number // default: 10
}

/**
 * PESOS CONFIGURÁVEIS PELO MENTOR (Total: 100)
 * Para ajustar: edite esta constante ou sobrescreva via settings no futuro.
 */
export const REVENDA_DEFAULT_WEIGHTS: RevendaScoreWeights = {
  recencia: 30,
  frequencia: 25,
  engajamento: 20,
  posicaoValor: 15,
  gatilhos: 10,
}

export interface RevendaSegmentConfig {
  key: RevendaSegmentKey
  label: string
  description: string
  badgeClass: string
  accentColor: string
  suggestedActionPattern: string
}

/**
 * CONFIGURAÇÃO DOS 5 SEGMENTOS DE REVENDA
 */
export const REVENDA_SEGMENTS: Record<RevendaSegmentKey, RevendaSegmentConfig> = {
  retomada: {
    key: 'retomada',
    label: 'Retomada',
    description: 'Paciente ativo recentemente mas sem interação nas últimas 2-4 semanas.',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300',
    accentColor: '#2563eb',
    suggestedActionPattern: 'Enviar mensagem de acompanhamento acolhedor e check-in pós-cuidado.',
  },
  fechamento: {
    key: 'fechamento',
    label: 'Fechamento',
    description: 'Orçamento enviado pendente de decisão ou negociação ativa.',
    badgeClass:
      'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300',
    accentColor: '#7c3aed',
    suggestedActionPattern:
      'Follow-up de proposta enviada com esclarecimento de condições e dúvidas.',
  },
  renovacao: {
    key: 'renovacao',
    label: 'Renovação',
    description:
      'Membro do Clube Dr. Caio com plano expirando nos próximos 30 dias ou recém-vencido.',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300',
    accentColor: '#d97706',
    suggestedActionPattern: 'Apresentar condições especiais de renovação do Clube Dr. Caio.',
  },
  novo_servico: {
    key: 'novo_servico',
    label: 'Novo Serviço',
    description:
      'Cliente fidelizado com histórico consistente, elegível para novos procedimentos ou protocolos.',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300',
    accentColor: '#059669',
    suggestedActionPattern:
      'Apresentar procedimento complementar ou evolução de protocolo clínico.',
  },
  reativacao: {
    key: 'reativacao',
    label: 'Reativação',
    description: 'Paciente ou contato inativo há mais de 45 dias sem retorno programado.',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300',
    accentColor: '#e11d48',
    suggestedActionPattern: 'Retomar contato com convite para avaliação de rotina ou novidades.',
  },
}

export interface RevendaScoreBreakdown {
  recencia: number // 0 a weights.recencia
  frequencia: number // 0 a weights.frequencia
  engajamento: number // 0 a weights.engajamento
  posicaoValor: number // 0 a weights.posicaoValor
  gatilhos: number // 0 a weights.gatilhos
  total: number // 0 a 100
  appliedWeights: RevendaScoreWeights
  triggerReasons: string[]
}

export interface RevendaContactItem {
  id: string
  contactId: string
  name: string
  phone: string
  formattedPhone: string
  instanceName: string
  stageKey: string
  stageLabel: string
  segment: RevendaSegmentKey
  segmentMeta: RevendaSegmentConfig
  score: number // 0-100
  breakdown: RevendaScoreBreakdown
  suggestedAction: string
  lastContactAt: Date | null
  daysSinceLastContact: number
  budgetValue: number
  isClubMember: boolean
  isPatient: boolean
  planExpiresAt: string | null
  planDaysRemaining: number | null
  hasOpenTask: boolean
  openTaskTitle?: string
  priorityLevel: 'urgente' | 'alta' | 'media' | 'baixa'
}

export interface RevendaCalculationContext {
  now?: number
  weights?: Partial<RevendaScoreWeights>
}

/**
 * Função pura que calcula o Score de Interesse e a Segmentação de Revenda
 * de acordo com as especificações da Fase 4.
 */
export function calculateRevendaItem(
  contact: CrmContact,
  conv: Conversation | undefined,
  contactTasks: Task[] = [],
  context: RevendaCalculationContext = {},
): RevendaContactItem {
  const now = context.now || Date.now()
  const weights: RevendaScoreWeights = {
    ...REVENDA_DEFAULT_WEIGHTS,
    ...(context.weights || {}),
  }

  // 1. Apuração temporal (Recência)
  let lastContactAt: Date | null = null

  if (conv?.last_message_timestamp) {
    const ts = Number(conv.last_message_timestamp)
    if (!isNaN(ts) && ts > 0) {
      const ms = ts > 1e12 ? ts : ts * 1000
      const parsed = new Date(ms)
      if (!isNaN(parsed.getTime())) {
        lastContactAt = parsed
      }
    }
  }
  if (!lastContactAt && contact?.last_synced_at) {
    lastContactAt = parseToDate(contact.last_synced_at)
  }
  if (!lastContactAt && contact?.updated) {
    lastContactAt = parseToDate(contact.updated)
  }

  const daysSinceLastContact =
    lastContactAt && !isNaN(lastContactAt.getTime())
      ? Math.max(0, (now - lastContactAt.getTime()) / 86400000)
      : 999

  // Cálculo: Recência (30 pts max)
  // Contato muito recente (<3 dias) = 30 pts; 3-7d = 25 pts; 7-15d = 20 pts; 15-30d = 14 pts; 30-60d = 8 pts; >60d = 3 pts
  let recenciaScore = 0
  if (daysSinceLastContact < 3) recenciaScore = weights.recencia
  else if (daysSinceLastContact <= 7) recenciaScore = Math.round(weights.recencia * 0.83)
  else if (daysSinceLastContact <= 15) recenciaScore = Math.round(weights.recencia * 0.66)
  else if (daysSinceLastContact <= 30) recenciaScore = Math.round(weights.recencia * 0.46)
  else if (daysSinceLastContact <= 60) recenciaScore = Math.round(weights.recencia * 0.26)
  else recenciaScore = Math.round(weights.recencia * 0.1)

  // 2. Frequência (25 pts max)
  // Baseada em sinais de volume de troca: mensagens não lidas, contatos frequentes, recall count, tarefas
  const unreadCount = Number(conv?.unread_count) || 0
  const recallCount = Number(contact?.recall_count) || 0
  const safeTasksList = Array.isArray(contactTasks) ? contactTasks : []
  const tasksCount = safeTasksList.length

  let frequenciaScore = 0
  // Interações históricas e trocas registradas
  let freqSignal = 0
  if (unreadCount > 0) freqSignal += 2
  if (recallCount > 0) freqSignal += Math.min(3, recallCount)
  if (tasksCount > 0) freqSignal += Math.min(3, tasksCount)
  if (contact?.is_patient) freqSignal += 2

  if (freqSignal >= 5) frequenciaScore = weights.frequencia
  else if (freqSignal >= 3) frequenciaScore = Math.round(weights.frequencia * 0.75)
  else if (freqSignal >= 1) frequenciaScore = Math.round(weights.frequencia * 0.5)
  else frequenciaScore = Math.round(weights.frequencia * 0.2)

  // 3. Engajamento (20 pts max)
  // Mensagem do cliente esperando resposta, ai_priority, care_status
  let engajamentoScore = 0
  const aiPriority = Number(contact?.ai_priority) || 0

  if (unreadCount > 0) {
    engajamentoScore += Math.round(weights.engajamento * 0.5) // Mensagem esperando
  }
  if (aiPriority >= 7) {
    engajamentoScore += Math.round(weights.engajamento * 0.5)
  } else if (aiPriority >= 4) {
    engajamentoScore += Math.round(weights.engajamento * 0.3)
  } else {
    engajamentoScore += Math.round(weights.engajamento * 0.15)
  }
  engajamentoScore = Math.min(weights.engajamento, engajamentoScore)

  // 4. Posição / Valor (15 pts max)
  // Estágio no funil, orçamento enviado, membro do clube
  let posicaoScore = 0
  const rawBudgetValue = contact?.budget_value
  const budgetValue =
    typeof rawBudgetValue === 'number' && Number.isFinite(rawBudgetValue)
      ? rawBudgetValue
      : Number(rawBudgetValue) && Number.isFinite(Number(rawBudgetValue))
        ? Number(rawBudgetValue)
        : 0
  const stage = String(contact?.stage || 'lead')
    .trim()
    .toLowerCase()

  if (stage === 'orcamento_enviado') {
    posicaoScore = weights.posicaoValor // Top valor potencial
  } else if (contact?.is_club_member) {
    posicaoScore = Math.round(weights.posicaoValor * 0.85) // Membro de clube recorrente
  } else if (stage === 'cliente') {
    posicaoScore = Math.round(weights.posicaoValor * 0.7)
  } else if (stage === 'em_atendimento') {
    posicaoScore = Math.round(weights.posicaoValor * 0.5)
  } else {
    posicaoScore = Math.round(weights.posicaoValor * 0.25)
  }

  // Bônus se houver valor monetário expresso
  if (budgetValue > 1000) {
    posicaoScore = Math.min(weights.posicaoValor, posicaoScore + 2)
  }

  // 5. Gatilhos (10 pts max)
  // Alertas de cuidado, orçamento sem resposta 7d, plano vencendo em 15d, retorno 30d
  const triggerReasons: string[] = []
  let gatilhosScore = 0

  // Gatilho: Orçamento há mais de 3-7 dias sem conclusão
  if (stage === 'orcamento_enviado' && daysSinceLastContact >= 3) {
    gatilhosScore += 4
    triggerReasons.push('Orçamento pendente há mais de 3 dias')
  }

  // Gatilho: Plano de Clube vencendo em até 20 dias ou recém expirado (-5 a 20 dias)
  let planDaysRemaining: number | null = null
  if (contact?.plan_expires_at) {
    const exp = parseToDate(contact.plan_expires_at)
    if (exp && !isNaN(exp.getTime())) {
      planDaysRemaining = Math.round((exp.getTime() - now) / 86400000)
      if (planDaysRemaining <= 20 && planDaysRemaining >= -10) {
        gatilhosScore += 4
        triggerReasons.push(
          planDaysRemaining >= 0
            ? `Clube vence em ${planDaysRemaining} dias`
            : `Clube vencido há ${Math.abs(planDaysRemaining)} dias`,
        )
      }
    }
  }

  // Gatilho: Alerta clínico ou cuidado especial
  const careStatus = contact?.care_status
  if (careStatus === 'precisa_atencao' || careStatus === 'alta_demanda') {
    gatilhosScore += 3
    triggerReasons.push('Alerta de cuidado clínico ativo')
  } else if (careStatus === 'precisa_retorno') {
    gatilhosScore += 3
    triggerReasons.push('Paciente precisa de retorno programado')
  }

  // Gatilho: Inatividade prolongada de paciente (retorno de rotina ~30-45 dias)
  if (contact?.is_patient && daysSinceLastContact >= 30 && daysSinceLastContact <= 60) {
    gatilhosScore += 3
    triggerReasons.push('Janela ideal para retorno de 30-45 dias')
  }

  // Trava no máximo de gatilhos
  gatilhosScore = Math.min(weights.gatilhos, gatilhosScore)

  // SOMA TOTAL DO SCORE (0 a 100)
  const totalScore = Math.min(
    100,
    Math.max(0, recenciaScore + frequenciaScore + engajamentoScore + posicaoScore + gatilhosScore),
  )

  // 6. DETERMINAÇÃO DO SEGMENTO DE REVENDA (Hierarquia ajustável)
  let segment: RevendaSegmentKey = 'retomada'

  if (contact?.is_club_member && (planDaysRemaining === null || planDaysRemaining <= 30)) {
    segment = 'renovacao'
  } else if (stage === 'orcamento_enviado' || budgetValue > 0) {
    segment = 'fechamento'
  } else if (daysSinceLastContact > 45) {
    segment = 'reativacao'
  } else if (contact?.is_patient && stage === 'cliente') {
    // Paciente que já fez procedimentos e está em dia
    if (daysSinceLastContact <= 35) {
      segment = 'novo_servico'
    } else {
      segment = 'retomada'
    }
  } else if (daysSinceLastContact > 14 && daysSinceLastContact <= 45) {
    segment = 'retomada'
  } else {
    segment = 'retomada'
  }

  // Nível de prioridade para a equipe Fabiana/Dr. Caio
  let priorityLevel: 'urgente' | 'alta' | 'media' | 'baixa' = 'media'
  if (totalScore >= 75 || triggerReasons.length >= 2) {
    priorityLevel = 'urgente'
  } else if (totalScore >= 55) {
    priorityLevel = 'alta'
  } else if (totalScore >= 35) {
    priorityLevel = 'media'
  } else {
    priorityLevel = 'baixa'
  }

  const safeSegment: RevendaSegmentKey = REVENDA_SEGMENTS[segment] ? segment : 'retomada'
  const segMeta = REVENDA_SEGMENTS[safeSegment] || REVENDA_SEGMENTS.retomada

  const actionSuggested =
    (typeof contact.ai_suggested_action === 'string' && contact.ai_suggested_action.trim()) ||
    (triggerReasons.length > 0
      ? `${triggerReasons[0]}. Propor contato.`
      : segMeta.suggestedActionPattern)

  const openTaskTitle =
    Array.isArray(contactTasks) && contactTasks[0]?.title
      ? String(contactTasks[0].title)
      : undefined

  const contactName =
    (typeof contact.contact_name === 'string' && contact.contact_name.trim()) ||
    (typeof contact.push_name === 'string' && contact.push_name.trim()) ||
    (typeof contact.phone === 'string' && contact.phone.trim()) ||
    (typeof contact.jid === 'string' && contact.jid.trim()) ||
    'Contato sem nome'

  const contactPhone =
    (typeof contact.phone === 'string' && contact.phone.trim()) ||
    (typeof contact.jid === 'string' && contact.jid.trim()) ||
    ''

  return {
    id: String(contact.id || ''),
    contactId: String(contact.id || ''),
    name: contactName,
    phone: contactPhone,
    formattedPhone: contactPhone,
    instanceName: String(contact.instance_name || 'Principal'),
    stageKey: stage || 'lead',
    stageLabel: stage || 'lead',
    segment: safeSegment,
    segmentMeta: segMeta,
    score: Number.isFinite(totalScore) ? Math.max(0, Math.min(100, Math.round(totalScore))) : 0,
    breakdown: {
      recencia: Number.isFinite(recenciaScore) ? recenciaScore : 0,
      frequencia: Number.isFinite(frequenciaScore) ? frequenciaScore : 0,
      engajamento: Number.isFinite(engajamentoScore) ? engajamentoScore : 0,
      posicaoValor: Number.isFinite(posicaoScore) ? posicaoScore : 0,
      gatilhos: Number.isFinite(gatilhosScore) ? gatilhosScore : 0,
      total: Number.isFinite(totalScore) ? Math.max(0, Math.min(100, Math.round(totalScore))) : 0,
      appliedWeights: weights,
      triggerReasons: Array.isArray(triggerReasons) ? triggerReasons : [],
    },
    suggestedAction: actionSuggested || 'Propor contato e verificar necessidades clínicas.',
    lastContactAt,
    daysSinceLastContact: Number.isFinite(daysSinceLastContact)
      ? Math.round(daysSinceLastContact)
      : 999,
    budgetValue: Number.isFinite(budgetValue) ? Math.max(0, budgetValue) : 0,
    isClubMember: Boolean(contact.is_club_member),
    isPatient: Boolean(contact.is_patient),
    planExpiresAt: contact.plan_expires_at || null,
    planDaysRemaining:
      typeof planDaysRemaining === 'number' && Number.isFinite(planDaysRemaining)
        ? planDaysRemaining
        : null,
    hasOpenTask: Array.isArray(contactTasks) && contactTasks.length > 0,
    openTaskTitle,
    priorityLevel,
  }
}
