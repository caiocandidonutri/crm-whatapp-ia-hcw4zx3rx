import pb from '@/lib/pocketbase/client'
import type { Appointment, AppointmentCity, AppointmentStatus } from '@/types/models'

export interface CreateAppointmentInput {
  patient_name: string
  patient_phone?: string
  patient_id?: string
  conversation_id?: string
  doctor?: string
  city: AppointmentCity
  location?: string
  starts_at: string
  ends_at: string
  status?: AppointmentStatus
  appointment_type?: string
  notes?: string
  account_id?: string
}

export interface UpdateAppointmentInput {
  patient_name?: string
  patient_phone?: string
  patient_id?: string
  conversation_id?: string
  doctor?: string
  city?: AppointmentCity
  location?: string
  starts_at?: string
  ends_at?: string
  status?: AppointmentStatus
  appointment_type?: string
  notes?: string
}

export interface AgendaSyncDiagnostic {
  status:
    | 'ok'
    | 'invalid_token'
    | 'wrong_url'
    | 'connection_error'
    | 'http_error'
    | 'external_error'
  message: string
  status_code?: number
  content_type_hint?: string
}

export interface RecommendedUrlCheck {
  url: string
  status:
    | 'ok'
    | 'invalid_token'
    | 'wrong_url'
    | 'connection_error'
    | 'http_error'
    | 'external_error'
  status_code?: number
  appointments_found: number
  contacts_found: number
  sample?: {
    id: string
    patient_name: string
    city: string
    starts_at: string | null
    status: string
  } | null
  message: string
}

export interface AgendaSyncStatus {
  configured: boolean
  external_url: string | null
  base_url?: string | null
  recommended_url?: string | null
  recommended_url_check?: RecommendedUrlCheck | null
  has_token?: boolean
  token_preview?: string | null
  last_sync: string | null
  last_status:
    | 'success'
    | 'partial'
    | 'error'
    | 'external_error'
    | 'wrong_url'
    | 'missing_credentials'
    | 'auth_failed'
    | 'connection_error'
    | 'pending'
    | string
  last_error: string | null
  details?: {
    pull_url?: string
    configured_url?: string
    used_fallback?: boolean
    pulled?: number
    pulled_contacts?: number
    pushed?: number
    errors?: string[]
    synced_at?: string
    missing_envs?: string[]
    status?: number
    content_type_hint?: string
    raw?: string
  } | null
  diagnostic?: AgendaSyncDiagnostic | null
  total_appointments: number
  pending_push: number
  reminders_stats?: {
    confirmations_sent: number
    reminders_day_sent: number
    confirmed_by_patient: number
  }
}

export interface AgendaSyncResult {
  success: boolean
  status: string
  pulled: number
  pushed: number
  pulled_contacts?: number
  errors?: string[]
  message?: string
  last_sync?: string
  used_fallback?: boolean
  effective_url?: string
}

export const CITY_DEFAULT_LOCATIONS: Record<AppointmentCity, string> = {
  'Carmo do Rio Claro': 'Climed',
  Alfenas: 'Instituto Harmoniza',
  'Monte Belo': 'Monte Belo',
  Online: 'Online',
}

/**
 * Helper para verificar se um erro é 429 (Too Many Requests / Rate limit).
 */
export function isAppointmentRateLimited(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    if ('status' in err && (err as { status: unknown }).status === 429) {
      return true
    }
    if ('statusCode' in err && (err as { statusCode: unknown }).statusCode === 429) {
      return true
    }
  }
  const str = String(err).toLowerCase()
  return str.includes('429') || str.includes('too many requests')
}

export async function listAppointments(options?: {
  startDate?: string
  endDate?: string
  city?: AppointmentCity | 'all'
  status?: AppointmentStatus | 'all'
  appointment_type?: string | 'all'
  patient_phone?: string
  patient_id?: string
}): Promise<Appointment[]> {
  const filters: string[] = []

  if (options?.startDate) {
    filters.push(`starts_at >= "${options.startDate}"`)
  }
  if (options?.endDate) {
    filters.push(`starts_at <= "${options.endDate}"`)
  }
  if (options?.city && options.city !== 'all') {
    filters.push(`city = "${options.city}"`)
  }
  if (options?.status && options.status !== 'all') {
    filters.push(`status = "${options.status}"`)
  }
  if (options?.appointment_type && options.appointment_type !== 'all') {
    filters.push(`appointment_type ~ "${options.appointment_type}"`)
  }
  if (options?.patient_phone) {
    const cleanDigits = options.patient_phone.replace(/\D/g, '')
    if (cleanDigits.length >= 8) {
      const suffix = cleanDigits.slice(-8)
      filters.push(`patient_phone ~ "${suffix}"`)
    }
  }
  if (options?.patient_id) {
    filters.push(`patient_id = "${options.patient_id}"`)
  }

  const filterStr = filters.join(' && ')

  const maxRetries = 3
  const delays = [1500, 3500, 7000]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await pb.collection('appointments').getFullList<Appointment>({
        filter: filterStr || undefined,
        sort: 'starts_at',
        requestKey: null,
      })
    } catch (err: unknown) {
      const is429 = isAppointmentRateLimited(err)

      if (is429 && attempt < maxRetries) {
        const delay = delays[attempt] + Math.floor(Math.random() * 400)
        console.warn(
          `[listAppointments] 429 Too Many Requests detectado. Tentativa ${attempt + 1}/${maxRetries} aguardando ${delay}ms...`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      throw err
    }
  }

  return []
}

export async function createAppointment(data: CreateAppointmentInput): Promise<Appointment> {
  const payload = {
    ...data,
    source: 'crm',
    doctor: data.doctor || 'Dr. Caio',
    location: data.location || CITY_DEFAULT_LOCATIONS[data.city] || 'Climed',
    status: data.status || 'agendado',
  }

  // Tentar associar conversation ou patient_id automaticamente se fornecido telefone
  if (data.patient_phone && (!payload.conversation_id || !payload.patient_id)) {
    const cleanDigits = data.patient_phone.replace(/\D/g, '')
    if (cleanDigits.length >= 8) {
      const suffix = cleanDigits.slice(-8)
      try {
        if (!payload.conversation_id) {
          const conv = await pb
            .collection('conversations')
            .getFirstListItem(`remote_jid ~ "${suffix}" || contact_phone ~ "${suffix}"`, {
              requestKey: null,
            })
          if (conv) {
            payload.conversation_id = conv.id
            if (!payload.account_id && conv.account_id) {
              payload.account_id = conv.account_id
            }
          }
        }
      } catch {
        /* intentionally ignored */
      }

      try {
        if (!payload.patient_id) {
          const contact = await pb
            .collection('crm_contacts')
            .getFirstListItem(`phone ~ "${suffix}" || jid ~ "${suffix}"`, {
              requestKey: null,
            })
          if (contact) {
            payload.patient_id = contact.id
            if (!payload.account_id && contact.account_id) {
              payload.account_id = contact.account_id
            }
          }
        }
      } catch {
        /* intentionally ignored */
      }
    }
  }

  return pb.collection('appointments').create<Appointment>(payload)
}

export async function updateAppointment(
  id: string,
  data: UpdateAppointmentInput,
): Promise<Appointment> {
  return pb.collection('appointments').update<Appointment>(id, data)
}

export async function deleteAppointment(id: string): Promise<boolean> {
  return pb.collection('appointments').delete(id)
}

export async function getAgendaSyncStatus(options?: {
  probe?: boolean
}): Promise<AgendaSyncStatus> {
  try {
    const url = options?.probe
      ? '/backend/v1/agenda/sync-status?probe=true'
      : '/backend/v1/agenda/sync-status'
    return await pb.send<AgendaSyncStatus>(url, {
      method: 'GET',
    })
  } catch (err) {
    return {
      configured: false,
      external_url: null,
      last_sync: null,
      last_status: 'error',
      last_error: err instanceof Error ? err.message : String(err),
      total_appointments: 0,
      pending_push: 0,
    }
  }
}

export async function triggerAgendaSync(): Promise<AgendaSyncResult> {
  return pb.send<AgendaSyncResult>('/backend/v1/agenda/sync', {
    method: 'POST',
  })
}
