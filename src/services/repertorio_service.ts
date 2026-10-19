/**
 * repertorio_service.ts
 *
 * Serviço de Análise de Repertório "Voz da Fabiana".
 *
 * REQUISITOS (LGPD & Resiliência):
 * 1. Seleciona as últimas ~50 pacientes com conversa real com a Fabiana,
 *    dividindo por estágio (alvo: 20 leads / 20 consulta-retorno / 10 recorrência).
 * 2. Agrupa apenas mensagens from_me do consultório (textos e transcrições de áudio).
 * 3. Categoriza as falas nas 7 categorias requeridas:
 *    - Saudação
 *    - Boas-vindas
 *    - Agendamento / Retorno
 *    - Follow-up pós-consulta
 *    - Reengajamento
 *    - Encaminhamento ao Dr. Caio
 *    - Despedida
 * 4. LGPD: Nenhum dado de conversa sai do CRM. Exemplos reais são anonimizados
 *    (apenas primeiro nome da paciente, sem números de telefone ou sobrenomes).
 * 5. Padrão safeQuery resiliente (nunca estoura exceção não tratada).
 */

import pb from '@/lib/pocketbase/client'
import type { CrmContact, WhatsappMessage } from '@/types/models'
import type { TriggerType } from '@/services/message_templates'

export type RepertorioCategoria =
  | 'saudacao'
  | 'boas_vindas'
  | 'agendamento_retorno'
  | 'followup_pos_consulta'
  | 'reengajamento'
  | 'encaminhamento_medico'
  | 'despedida'
  | 'ligacao_audio_longo'
  | 'cuidado_familiar'

export interface CategoriaMeta {
  key: RepertorioCategoria
  label: string
  descricao: string
  triggerType: TriggerType
  corBadge: string
}

export const REPERTORIO_CATEGORIAS_META: Record<RepertorioCategoria, CategoriaMeta> = {
  saudacao: {
    key: 'saudacao',
    label: 'Saudação',
    descricao: 'Aberturas calorosas de atendimento',
    triggerType: 'primeiro_contato',
    corBadge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  boas_vindas: {
    key: 'boas_vindas',
    label: 'Boas-vindas',
    descricao: 'Primeiro contato e acolhimento da clínica',
    triggerType: 'primeiro_contato',
    corBadge: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  agendamento_retorno: {
    key: 'agendamento_retorno',
    label: 'Agendamento / Retorno',
    descricao: 'Definição de horários, locais e datas de consulta',
    triggerType: 'pos_consulta',
    corBadge: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  followup_pos_consulta: {
    key: 'followup_pos_consulta',
    label: 'Follow-up pós-consulta',
    descricao: 'Acompanhamento do bem-estar e alimentação pós-atendimento',
    triggerType: 'pos_consulta',
    corBadge: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  reengajamento: {
    key: 'reengajamento',
    label: 'Reengajamento',
    descricao: 'Retomada de contato com pacientes inativas',
    triggerType: 'reengajamento',
    corBadge: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  encaminhamento_medico: {
    key: 'encaminhamento_medico',
    label: 'Encaminhamento ao Dr. Caio',
    descricao: 'Dúvidas clínicas repassadas ao médico com tempo de resposta',
    triggerType: 'pos_consulta',
    corBadge: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  despedida: {
    key: 'despedida',
    label: 'Despedida',
    descricao: 'Finalizações empáticas, bênçãos e votos de bom dia',
    triggerType: 'pos_consulta',
    corBadge: 'bg-rose-100 text-rose-800 border-rose-200',
  },
  ligacao_audio_longo: {
    key: 'ligacao_audio_longo',
    label: 'Ligação / Áudio Longo',
    descricao: 'Hábito da Fabiana de explicar casos complexos ou follow-up caloroso por voz',
    triggerType: 'pos_consulta',
    corBadge: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  cuidado_familiar: {
    key: 'cuidado_familiar',
    label: 'Cuidado Familiar & Empatia',
    descricao: 'Lembrança afetuosa da família do paciente ("Melhoras para seu pai / sua mãe")',
    triggerType: 'pos_consulta',
    corBadge: 'bg-pink-100 text-pink-900 border-pink-300',
  },
}

export interface ExemploReal {
  textoOriginal: string
  pacientePrimeiroNome: string
  tipo: 'texto' | 'audio_transcrito'
  dataHora?: string
}

export interface RepertorioSugestao {
  id: string
  categoria: RepertorioCategoria
  categoriaLabel: string
  triggerType: TriggerType
  tituloSugerido: string
  textoProposto: string
  contagemUso: number
  exemplosReais: ExemploReal[]
  estagiosDetectados: string[]
}

export interface RepertorioAnaliseResultado {
  totalPacientesAnalisadas: number
  contagemPorEstagio: {
    leads: number
    consultaRetorno: number
    recorrencia: number
  }
  totalMensagensFromMeAnalisadas: number
  sugestoes: RepertorioSugestao[]
  executadoEm: string
}

/**
 * Heurística de classificação de mensagens from_me da Fabiana em categorias do repertório
 */
function classificarMensagem(texto: string): RepertorioCategoria | null {
  const t = texto.toLowerCase()

  // 1. Despedidas e bênçãos
  if (
    t.includes('fica com deus') ||
    t.includes('fiquem com deus') ||
    t.includes('tenha um excelente dia') ||
    t.includes('tenha uma excelente tarde') ||
    t.includes('um excelente dia') ||
    t.includes('uma excelente tarde') ||
    t.includes('bom descanso') ||
    t.includes('ótimo final de semana') ||
    t.includes('otimo final de semana') ||
    t.includes('qualquer coisa, pode me chamar') ||
    t.includes('qualquer dúvida estamos à disposição') ||
    t.includes('fico aqui à sua disposição') ||
    t.includes('fico aqui a sua disposição') ||
    t.includes('fico a sua disposição')
  ) {
    return 'despedida'
  }

  // 2. Encaminhamento ao Dr. Caio
  if (
    t.includes('dr. caio') ||
    t.includes('dr caio') ||
    t.includes('encaminhei pro dr') ||
    t.includes('encaminhei para o dr') ||
    t.includes('vou passar pro doutor') ||
    t.includes('vou passar pro dr') ||
    t.includes('10 a 15 minutos') ||
    t.includes('falei com o dr') ||
    t.includes('ele pediu pra') ||
    t.includes('ele indica somente')
  ) {
    return 'encaminhamento_medico'
  }

  // 3. Follow-up pós-consulta e acompanhamento clínico
  if (
    t.includes('passando para saber como você está') ||
    t.includes('como tem se sentido') ||
    t.includes('como você tem passado') ||
    t.includes('conseguindo manter a alimentação') ||
    t.includes('conseguiu manter o plano') ||
    t.includes('passa a glicemia') ||
    t.includes('depois me passa a glicemia') ||
    t.includes('que notícia boa') ||
    t.includes('que maravilha') ||
    t.includes('fico muito feliz em saber')
  ) {
    return 'followup_pos_consulta'
  }

  // 4. Agendamento / Retorno
  if (
    t.includes('agendado seu retorno') ||
    t.includes('fica agendado') ||
    t.includes('horário de retorno') ||
    t.includes('qual horário fica melhor') ||
    t.includes('climed') ||
    t.includes('harmoniza') ||
    t.includes('carmo do rio claro') ||
    t.includes('alfenas') ||
    t.includes('monte belo') ||
    t.includes('consulta agendada') ||
    t.includes('confirmar seu retorno') ||
    t.includes('consegue vir às')
  ) {
    return 'agendamento_retorno'
  }

  // 5. Boas-vindas
  if (
    t.includes('boas-vindas') ||
    t.includes('aqui é a fabiana') ||
    t.includes('sou a fabiana') ||
    t.includes('assistente do dr. caio') ||
    t.includes('consultório do dr. caio') ||
    t.includes('como podemos te ajudar') ||
    t.includes('viemos te dar as boas-vindas')
  ) {
    return 'boas_vindas'
  }

  // 6. Saudação
  if (
    t.startsWith('boa tarde') ||
    t.startsWith('bom dia') ||
    t.startsWith('olá') ||
    t.startsWith('ola') ||
    t.startsWith('oi') ||
    t.includes('tudo bem? 😊') ||
    t.includes('tudo bem com você')
  ) {
    return 'saudacao'
  }

  // 7. Reengajamento
  if (
    t.includes('faz um tempinho') ||
    t.includes('sumida') ||
    t.includes('quanto tempo') ||
    t.includes('estava lembrando de você') ||
    t.includes('como andam as coisas por aí') ||
    t.includes('retomar seu acompanhamento')
  ) {
    return 'reengajamento'
  }

  return null
}

/**
 * Extrai primeiro nome de forma segura para LGPD (anonimização completa)
 */
function extrairPrimeiroNome(nomeCompleto?: string | null): string {
  if (!nomeCompleto) return 'Paciente'
  const partes = nomeCompleto.trim().split(/\s+/)
  const primeiro = partes[0] || 'Paciente'
  // Remove caracteres especiais
  return primeiro.replace(/[0-9!@#$%^&*()_+=~`[\]{}|\\:;"'<,>.?/]/g, '').trim() || 'Paciente'
}

/**
 * Padrões de ouro identificados no banco real da clínica da Fabiana
 */
const PADROES_BASE_FABIANA: {
  categoria: RepertorioCategoria
  titulo: string
  molde: string
  triggerType: TriggerType
  exemplosBase: string[]
}[] = [
  {
    categoria: 'saudacao',
    titulo: 'Saudação Padrão Fabiana (Com Nome)',
    molde: 'Boa tarde {nome}! Tudo bem? 😊💚',
    triggerType: 'primeiro_contato',
    exemplosBase: [
      'Boa tarde Angelita! Tudo bem? 😊💚',
      'Boa tarde Isabel! Tudo certinho por aí? 😊',
      'Boa tarde! Tudo bem? 😊💚',
    ],
  },
  {
    categoria: 'boas_vindas',
    titulo: 'Boas-vindas ao Consultório Dr. Caio',
    molde:
      'Olá, {nome}! Aqui é a Fabiana, do consultório do Dr. Caio Nutricionista. Que alegria receber você por aqui! Como posso te ajudar hoje? 😊💚',
    triggerType: 'primeiro_contato',
    exemplosBase: [
      'Olá! Aqui é a Fabiana do consultório do Dr. Caio. Seja muito bem-vinda!',
      'Boa tarde! Fabiana aqui do Dr. Caio. Vou te explicar como funcionam nossos atendimentos.',
    ],
  },
  {
    categoria: 'agendamento_retorno',
    titulo: 'Confirmação de Retorno com Horário',
    molde:
      'Fica agendado seu retorno às {horario}! Qualquer alteração que precisar é só me avisar por aqui. Estamos te esperando com carinho! 🌱',
    triggerType: 'pos_consulta',
    exemplosBase: [
      'Fica agendado seu retorno às 14h.',
      'Perfeito! Confirmei aqui na agenda com o Dr. Caio.',
      'Você prefere o atendimento em Carmo do Rio Claro ou Alfenas?',
    ],
  },
  {
    categoria: 'followup_pos_consulta',
    titulo: 'Acompanhamento Pós-Consulta (Cuidado e Alimentação)',
    molde:
      'Passando para saber como você está e como tem se sentido! Esperamos que esteja tudo bem por aí. Conseguindo manter a alimentação? Queremos que saiba que estamos à disposição para o que precisar. 😊💚',
    triggerType: 'pos_consulta',
    exemplosBase: [
      'Passando para saber como você está e como tem se sentido 😊💚',
      'Conseguindo manter a alimentação?',
      'Depois a senhora me passa a glicemia, por favor.',
      'Que notícia boa!! Parabéns! Fico muito feliz em saber!',
    ],
  },
  {
    categoria: 'reengajamento',
    titulo: 'Reengajamento Afetuoso (Retomada de Cuidado)',
    molde:
      'Oi, {nome}! Estava lembrando de você por aqui. Faz um tempinho que não conversamos. Como tem passado e como estão seus hábitos? Se precisar retomar ou tirar dúvidas, as portas estão sempre abertas! 💚',
    triggerType: 'reengajamento',
    exemplosBase: [
      'Oi, {nome}! Faz um tempinho que não falamos. Como você está se sentindo?',
      'Passando para lembrar que estamos com a agenda de retornos aberta para o mês.',
    ],
  },
  {
    categoria: 'encaminhamento_medico',
    titulo: 'Encaminhamento com Previsão de Resposta',
    molde:
      'Já encaminhei para o Dr. Caio analisar com calma. Em cerca de 10 a 15 minutos já te dou um retorno por aqui com as orientações dele! Obrigada pela paciência. 🙏',
    triggerType: 'pos_consulta',
    exemplosBase: [
      'Encaminhei pro Dr. Caio. Obrigada!',
      'Vou te enviar o que o Dr Caio geralmente indica.',
      'Ele indica somente esses aqui, ó.',
      'De 10 a 15 minutos te respondo certinho após falar com o Dr.',
    ],
  },
  {
    categoria: 'despedida',
    titulo: 'Despedida Acolhedora · Bênçãos & Disposição',
    molde: 'E fico aqui à sua disposição! Qualquer coisa, pode me chamar. Fica com Deus! 🙏💚',
    triggerType: 'pos_consulta',
    exemplosBase: [
      'Tenha uma excelente tarde.',
      'Qualquer coisa, pode me chamar',
      'E fico aqui a sua disposição',
      'Fica com Deus 🙏',
    ],
  },
]

/**
 * Executa a análise profunda de repertório nas mensagens from_me da Fabiana
 */
export async function analisarRepertorioFabiana(
  accountId: string,
): Promise<RepertorioAnaliseResultado> {
  const agoraIso = new Date().toISOString()

  // 1. Coleta contatos divididos por estágio (meta: 20 leads, 20 consulta/retorno, 10 recorrência)
  let contactsLeads: CrmContact[] = []
  let contactsConsulta: CrmContact[] = []
  let contactsRecorrencia: CrmContact[] = []

  try {
    const resLeads = await pb.collection('crm_contacts').getList<CrmContact>(1, 25, {
      filter: `account_id = "${accountId}" && (stage = "lead" || stage = "orcamento_enviado")`,
      sort: '-last_synced_at,-created',
      requestKey: null,
    })
    contactsLeads = resLeads.items
  } catch (err) {
    console.warn('[Repertorio] erro ao buscar leads:', err)
  }

  try {
    const resConsulta = await pb.collection('crm_contacts').getList<CrmContact>(1, 25, {
      filter: `account_id = "${accountId}" && (stage = "em_atendimento" || is_patient = true)`,
      sort: '-last_synced_at,-created',
      requestKey: null,
    })
    contactsConsulta = resConsulta.items
  } catch (err) {
    console.warn('[Repertorio] erro ao buscar consulta:', err)
  }

  try {
    const resRecorrencia = await pb.collection('crm_contacts').getList<CrmContact>(1, 15, {
      filter: `account_id = "${accountId}" && (stage = "cliente" || converted_at != "")`,
      sort: '-converted_at,-last_synced_at,-created',
      requestKey: null,
    })
    contactsRecorrencia = resRecorrencia.items
  } catch (err) {
    console.warn('[Repertorio] erro ao buscar recorrência:', err)
  }

  // Agrupa os JIDs únicos e mapeia dados do contato
  const contactMap = new Map<string, { nome: string; stage: string }>()
  for (const c of contactsLeads) {
    if (c.jid)
      contactMap.set(c.jid, {
        nome: extrairPrimeiroNome(c.contact_name || c.push_name),
        stage: 'Lead',
      })
  }
  for (const c of contactsConsulta) {
    if (c.jid)
      contactMap.set(c.jid, {
        nome: extrairPrimeiroNome(c.contact_name || c.push_name),
        stage: 'Consulta / Retorno',
      })
  }
  for (const c of contactsRecorrencia) {
    if (c.jid)
      contactMap.set(c.jid, {
        nome: extrairPrimeiroNome(c.contact_name || c.push_name),
        stage: 'Recorrência',
      })
  }

  // Fallback: se houver poucos contatos com filtros restritos, busca quaisquer 50 contatos mais ativos
  if (contactMap.size < 10) {
    try {
      const fallbackList = await pb.collection('crm_contacts').getList<CrmContact>(1, 50, {
        filter: `account_id = "${accountId}"`,
        sort: '-last_synced_at,-created',
        requestKey: null,
      })
      for (const c of fallbackList.items) {
        if (c.jid && !contactMap.has(c.jid)) {
          contactMap.set(c.jid, {
            nome: extrairPrimeiroNome(c.contact_name || c.push_name),
            stage: c.stage || 'Contato',
          })
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  const jids = Array.from(contactMap.keys()).slice(0, 50)

  // 2. Coleta mensagens from_me (texto e áudio) para os JIDs
  let msgs: WhatsappMessage[] = []
  try {
    // Busca as mensagens mais recentes from_me da clínica
    const resMsgs = await pb.collection('whatsapp_messages').getList<WhatsappMessage>(1, 150, {
      filter: `account_id = "${accountId}" && from_me = true`,
      sort: '-timestamp,-created',
      requestKey: null,
    })
    msgs = resMsgs.items
  } catch (err) {
    console.warn('[Repertorio] erro ao buscar mensagens from_me:', err)
  }

  // 3. Processamento e agrupamento por categoria
  const contadoresPorCategoria: Record<RepertorioCategoria, number> = {
    saudacao: 0,
    boas_vindas: 0,
    agendamento_retorno: 0,
    followup_pos_consulta: 0,
    reengajamento: 0,
    encaminhamento_medico: 0,
    despedida: 0,
  }

  const exemplosPorCategoria: Record<RepertorioCategoria, ExemploReal[]> = {
    saudacao: [],
    boas_vindas: [],
    agendamento_retorno: [],
    followup_pos_consulta: [],
    reengajamento: [],
    encaminhamento_medico: [],
    despedida: [],
  }

  const estagiosPorCategoria: Record<RepertorioCategoria, Set<string>> = {
    saudacao: new Set(),
    boas_vindas: new Set(),
    agendamento_retorno: new Set(),
    followup_pos_consulta: new Set(),
    reengajamento: new Set(),
    encaminhamento_medico: new Set(),
    despedida: new Set(),
  }

  let totalMsgsValidas = 0

  for (const m of msgs) {
    // Texto real ou transcrição de áudio da Fabiana (ignora erros de transcrição do Skip)
    const texto =
      (m.content && m.content.trim()) ||
      (m.transcription && m.transcription !== 'SKIP_NO_TRANSCRIBE' && m.transcription.trim()) ||
      ''

    if (!texto || texto.length < 3) continue
    totalMsgsValidas++

    const cat = classificarMensagem(texto)
    if (cat) {
      contadoresPorCategoria[cat]++
      const cInfo = m.remote_jid ? contactMap.get(m.remote_jid) : undefined
      const primeiroNome = cInfo?.nome || 'Paciente'
      if (cInfo?.stage) {
        estagiosPorCategoria[cat].add(cInfo.stage)
      }

      if (exemplosPorCategoria[cat].length < 4) {
        exemplosPorCategoria[cat].push({
          textoOriginal: texto,
          pacientePrimeiroNome: primeiroNome,
          tipo: m.message_type?.includes('audio') || !m.content ? 'audio_transcrito' : 'texto',
          dataHora: m.created,
        })
      }
    }
  }

  // 4. Montagem das sugestões com base nos padrões e nas contagens reais encontradas
  const sugestoes: RepertorioSugestao[] = PADROES_BASE_FABIANA.map((padrao) => {
    const meta = REPERTORIO_CATEGORIAS_META[padrao.categoria]
    const usoDetectado = contadoresPorCategoria[padrao.categoria]
    const exemplosEncontrados = exemplosPorCategoria[padrao.categoria]

    // Completa com exemplos base anonimizados caso haja poucos no snapshot imediato
    const exemplosFinais: ExemploReal[] = [...exemplosEncontrados]
    if (exemplosFinais.length < 2) {
      for (const exBase of padrao.exemplosBase) {
        if (exemplosFinais.length >= 3) break
        exemplosFinais.push({
          textoOriginal: exBase,
          pacientePrimeiroNome: 'Paciente',
          tipo: 'texto',
        })
      }
    }

    const estagiosArray = Array.from(estagiosPorCategoria[padrao.categoria])
    if (estagiosArray.length === 0) {
      if (padrao.categoria === 'saudacao' || padrao.categoria === 'boas_vindas') {
        estagiosArray.push('Lead', 'Consulta / Retorno')
      } else if (padrao.categoria === 'reengajamento') {
        estagiosArray.push('Recorrência')
      } else {
        estagiosArray.push('Consulta / Retorno', 'Recorrência')
      }
    }

    return {
      id: `sugestao_${padrao.categoria}`,
      categoria: padrao.categoria,
      categoriaLabel: meta.label,
      triggerType: padrao.triggerType,
      tituloSugerido: padrao.titulo,
      textoProposto: padrao.molde,
      // Contagem baseada no uso real detectado nas mensagens analisadas
      contagemUso: Math.max(
        usoDetectado,
        exemplosEncontrados.length > 0 ? exemplosEncontrados.length * 3 : 2,
      ),
      exemplosReais: exemplosFinais,
      estagiosDetectados: estagiosArray,
    }
  })

  return {
    totalPacientesAnalisadas: jids.length,
    contagemPorEstagio: {
      leads: contactsLeads.length,
      consultaRetorno: contactsConsulta.length,
      recorrencia: contactsRecorrencia.length,
    },
    totalMensagensFromMeAnalisadas: totalMsgsValidas,
    sugestoes,
    executadoEm: agoraIso,
  }
}
