import pb from '@/lib/pocketbase/client'

/** Períodos válidos para sync_period_days. 0 = importar tudo. */
export type SyncPeriod = 0 | 1 | 7 | 30 | 90

export const criarInstancia = async (instanceName?: string, syncPeriodDays?: SyncPeriod) => {
  return pb.send<{ instanceName: string; qrcodeBase64: string; status: string }>(
    '/backend/v1/whatsapp/create-instance',
    {
      method: 'POST',
      body: JSON.stringify({ instanceName, syncPeriodDays }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const consultarStatusInstancia = async (instanceName: string) => {
  return pb.send<{ status: string; instanceName: string; qrcodeBase64?: string }>(
    `/backend/v1/whatsapp/instance-status?instanceName=${encodeURIComponent(instanceName)}`,
    {
      method: 'GET',
    },
  )
}

export const desconectarInstancia = async (instanceName: string) => {
  return pb.send<{ success: boolean }>('/backend/v1/whatsapp/disconnect', {
    method: 'POST',
    body: JSON.stringify({ instanceName }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Apaga TODOS os dados do usuário logado (instâncias, conversations,
 * mensagens, CRM) E o registro de usuário em si. Sem volta.
 */
export const factoryReset = async () => {
  return pb.send<{
    success: boolean
    deleted: {
      messages: number
      conversations: number
      crm_contacts: number
      instances: number
    }
  }>('/backend/v1/whatsapp/factory-reset', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const diagnosticarWebhook = async (instanceName: string) => {
  return pb.send<any>('/backend/v1/whatsapp/debug-webhook', {
    method: 'POST',
    body: JSON.stringify({ instanceName }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const enviarTexto = async (instanceName: string, number: string, text: string) => {
  return pb.send<{ success: boolean; message: any }>('/backend/v1/whatsapp/send-message', {
    method: 'POST',
    body: JSON.stringify({ instanceName, number, text }),
    headers: { 'Content-Type': 'application/json' },
  })
}

export const reimportarHistorico = async (instanceName: string, syncPeriodDays?: SyncPeriod) => {
  return pb.send<{ success: boolean; qrcodeBase64: string; instanceName: string }>(
    '/backend/v1/whatsapp/reimport-history',
    {
      method: 'POST',
      body: JSON.stringify({ instanceName, syncPeriodDays }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const sincronizarConversa = async (
  instanceName: string,
  remoteJid: string,
  /** Paginação: timestamp Unix (segundos). Se passar, retorna até 50 msgs anteriores. */
  before?: number,
) => {
  return pb.send<{
    success: boolean
    skipped?: boolean
    reason?: string
    inserted?: number
    total_returned?: number
    /** True quando a Evolution retornou 50 candidatos (provavelmente
     *  tem mais antigas além desse batch). False quando retornou menos
     *  que 50 (esgotou o cache da Evolution pra esse filtro). Usado
     *  pelo front pra decidir se mostra ou esconde o botão "Carregar
     *  mais antigas". */
    has_more?: boolean
  }>('/backend/v1/whatsapp/sync-conversation', {
    method: 'POST',
    body: JSON.stringify({ instance_name: instanceName, remote_jid: remoteJid, before }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Força o backfill de `last_message_timestamp` em todas as conversations
 * do user logado (SQL direto). Usado quando detectamos convs sem o
 * timestamp real do Baileys populado.
 */
export const fazerBackfillTimestamps = async () => {
  return pb.send<{
    success: boolean
    updated: number
    pending_before: number
    pending_after: number
  }>('/backend/v1/whatsapp/backfill-timestamps', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Edita manualmente o nome do contato em uma conversa. Atualiza tanto
 * a `conversations.contact_name` quanto o registro `crm_contacts`
 * correspondente (se existir) em uma única chamada — o backend cuida
 * da sincronia.
 */
export const atualizarNomeContato = async (
  instance_name: string,
  remote_jid: string,
  contact_name: string,
) => {
  return pb.send<{ success: boolean; contact_name: string }>(
    '/backend/v1/whatsapp/update-contact-name',
    {
      method: 'POST',
      body: JSON.stringify({ instance_name, remote_jid, contact_name }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const alternarArquivamentoConversa = async (conversationId: string, archived: boolean) => {
  return pb.send<{ success: boolean; archived: boolean }>(
    '/backend/v1/whatsapp/archive-conversation',
    {
      method: 'POST',
      body: JSON.stringify({ conversationId, archived }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const arquivarConversa = alternarArquivamentoConversa

export const atualizarConversaAi = async (
  conversationId: string,
  aiAgentId: string | null,
  aiEnabled: boolean,
) => {
  return pb.collection('conversations').update(conversationId, {
    ai_agent_id: aiAgentId,
    ai_enabled: aiEnabled,
  })
}

export const enviarMidia = async (
  instanceName: string,
  number: string,
  file: File,
  mediatype: string,
  caption?: string,
) => {
  const base64Str = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  return pb.send<{ success: boolean; message: any }>('/backend/v1/whatsapp/send-media', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      number,
      mediatype,
      caption: caption || '',
      mimetype: file.type,
      fileName: file.name,
      base64: base64Str,
    }),
    headers: { 'Content-Type': 'application/json' },
  })
}
