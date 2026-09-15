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

export interface AgendaSyncStatus {
  configured: boolean
  external_url: string | null
  last_sync: string | null
  last_status:
    | 'success'
    | 'partial'
    | 'error'
    | 'missing_credentials'
    | 'auth_failed'
    | 'connection_error'
    | 'pending'
    | string
  last_error: string | null
  details?: {
    pulled?: number
    pushed?: number
    errors?: string[]
    synced_at?: string
    missing_envs?: string[]
  } | null
  total_appointments: number
  pending_push: number
}

export interface AgendaSyncResult {
  success: boolean
  status: string
  pulled: number
  pushed: number
  errors?: string[]
  message?: string
  last_sync?: string
}

export const CITY_DEFAULT_LOCATIONS: Record<AppointmentCity, string> = {
  'Carmo do Rio Claro': 'Climed',
  Alfenas: 'Instituto Harmoniza',
  'Monte Belo': 'Monte Belo',
  Online: 'Online',
}

export async function listAppointments(options?: {
  startDate?: string
  endDate?: string
  city?: AppointmentCity | 'all'
  status?: AppointmentStatus | 'all'
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

  const filterStr = filters.join(' && ')

  return pb.collection('appointments').getFullList<Appointment>({
    filter: filterStr || undefined,
    sort: 'starts_at',
    requestKey: null,
  })
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

export async function getAgendaSyncStatus(): Promise<AgendaSyncStatus> {
  try {
    return await pb.send<AgendaSyncStatus>('/backend/v1/agenda/sync-status', {
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
