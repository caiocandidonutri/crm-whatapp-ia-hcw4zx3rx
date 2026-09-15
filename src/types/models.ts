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

import type { RecordModel } from 'pocketbase'

export interface Category extends RecordModel {
  account_id: string
  name: string
  color: CategoryColor
  icon?: string
  created_by?: string
}

export interface Account extends RecordModel {
  name: string
  owner_id: string
}

export interface AccountMember extends RecordModel {
  account_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at?: string
}

export interface AccountInvite extends RecordModel {
  account_id: string
  email: string
  role: 'owner' | 'member'
  invited_by: string
}

export interface AiAgent extends RecordModel {
  account_id?: string
  user_id: string
  name: string
  system_prompt: string
  documents?: string | string[] | any
}

export interface User extends RecordModel {
  name: string
  email: string
  avatar: string
}

export interface WhatsappInstance extends RecordModel {
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
}

export interface Conversation extends RecordModel {
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
}

export interface CrmContact extends RecordModel {
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
    stage_id?: { id: string; label?: string; title?: string }
    [key: string]: any
  }
}

export interface CrmCompany extends RecordModel {
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
}

export interface WhatsappMessage extends RecordModel {
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
}

export interface Task extends RecordModel {
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
}

export interface CareFollowupRule extends RecordModel {
  account_id: string
  name: string
  followup_days: number
  reminder_text?: string
}

export interface CareAlertSettings extends RecordModel {
  account_id: string
  whatsapp_alert_phone: string
  followup_alert_enabled: boolean
  needs_care_alert_enabled: boolean
  confirmation_alert_enabled: boolean
  confirmation_hours_before: number
}

export interface CareAlert extends RecordModel {
  account_id: string
  type: 'followup' | 'needs_care' | 'confirmacao_24h'
  crm_contact_id?: string
  conversation_id?: string
  message: string
  status: 'pending' | 'sent' | 'failed'
  sent_at?: string
  expand?: {
    crm_contact_id?: CrmContact
  }
}

export interface MessageTemplate extends RecordModel {
  account_id: string
  name: string
  trigger_type: 'primeiro_contato' | 'reengajamento' | 'pos_consulta'
  content: string
  created_by?: string
}

export interface CareSilencePeriod extends RecordModel {
  account_id: string
  start_time: string
  end_time: string
  weekdays?: number[]
  enabled: boolean
}

export interface CareFollowupThreshold extends RecordModel {
  account_id: string
  category: 'nao_respondeu' | 'precisa_atencao' | 'perdido'
  days: number
  enabled: boolean
}

export interface Notification extends RecordModel {
  user_id: string
  account_id?: string
  type: 'message' | 'care_alert' | 'task' | 'system'
  title: string
  body?: string
  conversation_id?: string
  crm_contact_id?: string
  task_id?: string
  read?: boolean
}

export type AppointmentCity = 'Carmo do Rio Claro' | 'Alfenas' | 'Monte Belo' | 'Online'

export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'realizado'
  | 'faltou'
  | 'remarcado'
  | 'cancelado'

export type AppointmentSource = 'agenda_externa' | 'crm'

export interface Appointment extends RecordModel {
  account_id?: string
  patient_name: string
  patient_phone?: string
  patient_id?: string
  conversation_id?: string
  doctor?: string
  city: AppointmentCity
  location?: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  appointment_type?: string
  source: AppointmentSource
  external_id?: string
  notes?: string
  sync_hash?: string
  last_synced_at?: string
  sync_error?: string
}

export interface SyncState extends RecordModel {
  key: string
  last_sync?: string
  last_status?: string
  last_error?: string
  details?: Record<string, unknown>
}
