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
  documents?: string
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
  import_total_count?: number
  import_started_at?: string
  import_finished_at?: string
  sync_period_days?: number
  last_health_check_at?: string
  last_webhook_reconfigured_at?: string
  last_instance_restart_at?: string
  health_check_failures?: number
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
  stage: string
  ai_suggested_action?: string
  ai_priority?: number
  is_patient?: boolean
  converted_at?: string
  care_status?: string
  last_synced_at?: string
  // Empresa (migration 0024)
  company_id?: string
  role?: string
  email?: string
  assigned_to?: string
  category_ids?: string[]
  followup_rule_id?: string
  // expand opcional do PB ao buscar com `?expand=company_id`
  expand?: {
    company_id?: CrmCompany
    assigned_to?: User
    followup_rule_id?: CareFollowupRule
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
  is_forwarded?: boolean
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
  care_category?:
    | 'sem_categoria'
    | 'nao_respondeu'
    | 'precisa_retorno'
    | 'precisa_consulta'
    | 'precisa_atencao'
    | 'followup_10_15'
    | 'alta_demanda'
  expand?: {
    assigned_to?: User
    crm_contact_id?: CrmContact
    conversation_id?: Conversation
  }
  created: string
  updated: string
}

export interface CareFollowupRule {
  id: string
  account_id: string
  name: string
  followup_days: number
  reminder_text?: string
  created: string
  updated: string
}

export interface CareAlertSettings {
  id: string
  account_id: string
  whatsapp_alert_phone: string
  followup_alert_enabled: boolean
  needs_care_alert_enabled: boolean
  confirmation_alert_enabled: boolean
  confirmation_hours_before: number
  created: string
  updated: string
}

export interface CareAlert {
  id: string
  account_id: string
  type: 'followup' | 'needs_care' | 'confirmacao_24h'
  crm_contact_id?: string
  conversation_id?: string
  message: string
  status: 'pending' | 'sent' | 'failed'
  sent_at?: string
  created: string
  updated: string
  expand?: {
    crm_contact_id?: CrmContact
  }
}

export interface MessageTemplate {
  id: string
  account_id: string
  name: string
  trigger_type: 'primeiro_contato' | 'reengajamento' | 'pos_consulta'
  content: string
  created_by?: string
  created: string
  updated: string
}

export interface CareSilencePeriod {
  id: string
  account_id: string
  start_time: string
  end_time: string
  weekdays?: number[]
  enabled: boolean
  created: string
  updated: string
}

export interface CareFollowupThreshold {
  id: string
  account_id: string
  category: 'nao_respondeu' | 'precisa_atencao' | 'perdido'
  days: number
  enabled: boolean
  created: string
  updated: string
}

export interface Notification {
  id: string
  user_id: string
  account_id?: string
  type: 'message' | 'care_alert' | 'task'
  title: string
  body?: string
  conversation_id?: string
  crm_contact_id?: string
  task_id?: string
  read?: boolean
  created: string
  updated: string
}
