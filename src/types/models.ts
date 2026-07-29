export type CategoryColor =
  | 'slate'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'

export interface Category {
  id: string
  account_id: string
  name: string
  color: CategoryColor
  icon?: string
  created_by?: string
  created: string
  updated: string
}

export interface Account {
  id: string
  name: string
  owner_id: string
  created: string
  updated: string
}

export interface AccountMember {
  id: string
  account_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at?: string
  created: string
  updated: string
}

export interface AccountInvite {
  id: string
  account_id: string
  email: string
  role: 'owner' | 'member'
  invited_by: string
  created: string
  updated: string
}

export interface AiAgent {
  id: string
  account_id?: string
  user_id: string
  name: string
  system_prompt: string
  created: string
  updated: string
}

export interface User {
  id: string
  name: string
  email: string
  avatar: string
}

export interface WhatsappInstance {
  id: string
  account_id?: string
  user_id: string
  instance_name: string
  instance_id?: string
  instance_hash?: string
  status: 'creating' | 'qrcode' | 'connected' | 'disconnected'
  phone_number?: string
  needs_initial_sync?: boolean
  needs_resync?: boolean
  auth_failure_count?: number
  qrcode_base64?: string
  is_importing_history?: boolean
  import_messages_count?: number
  import_started_at?: string
  import_finished_at?: string
  sync_period_days?: number
  created: string
  updated: string
}

export interface Conversation {
  id: string
  account_id?: string
  user_id: string
  instance_name: string
  remote_jid: string
  contact_name?: string
  contact_phone?: string
  is_group?: boolean
  type: 'individual' | 'group'
  avatar?: string
  avatar_url?: string
  last_message?: string
  last_message_timestamp?: number
  unread_count: number
  group_size?: number
  history_synced_at?: string
  history_oldest_timestamp?: number
  archived?: boolean
  ai_agent_id?: string
  ai_enabled?: boolean
  ai_conversation_id?: string
  category_ids?: string[]
  created: string
  updated: string
}

export interface CrmContact {
  id: string
  account_id?: string
  user_id: string
  instance_name: string
  jid: string
  phone?: string
  push_name?: string
  contact_name?: string
  avatar_url?: string
  notes?: string
  stage: 'lead' | 'em_atendimento' | 'cliente' | 'perdido'
  last_synced_at?: string
  // Empresa (migration 0024)
  company_id?: string
  role?: string
  email?: string
  assigned_to?: string
  category_ids?: string[]
  // expand opcional do PB ao buscar com `?expand=company_id`
  expand?: {
    company_id?: CrmCompany
    assigned_to?: User
  }
  created: string
  updated: string
}

export interface CrmCompany {
  id: string
  account_id?: string
  user_id: string
  name: string
  cnpj?: string
  website?: string
  linkedin_url?: string
  industry?: string
  size?: string
  logo_url?: string
  notes?: string
  created: string
  updated: string
}

export interface WhatsappMessage {
  id: string
  account_id?: string
  user_id: string
  instance_name: string
  remote_jid: string
  from_me: boolean
  message_id?: string
  push_name?: string
  content?: string
  message_type?: string
  media_file?: string
  media_url?: string
  media_mimetype?: string
  media_filename?: string
  status?: string
  timestamp?: number
  participant_jid?: string
  participant_pushname?: string
  reactions?: any
  link_url?: string
  link_title?: string
  link_description?: string
  link_thumbnail_b64?: string
  created: string
  updated: string
}

export interface Task {
  id: string
  account_id?: string
  user_id: string
  title: string
  description?: string
  status: 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
  priority: 'baixa' | 'media' | 'alta' | 'urgente'
  due_date?: string
  crm_contact_id?: string
  crm_company_id?: string
  conversation_id?: string
  linked_message_ids?: string[]
  completed_at?: string
  assigned_to?: string
  expand?: {
    assigned_to?: User
  }
  created: string
  updated: string
}
