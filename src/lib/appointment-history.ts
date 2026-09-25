import { Appointment } from '@/types/models'
import { cleanPhoneDigits } from '@/lib/phone'
import { parseToDate } from '@/lib/datetime'

export type InferredAppointmentType = 'Consulta' | 'Retorno' | 'Consultoria' | string

export interface PatientAppointmentHistoryInfo {
  inferredType: InferredAppointmentType
  isFirstConsultation: boolean
  priorVisitsCount: number
}

/**
 * Normaliza a chave do paciente a partir do telefone (últimos 8 dígitos)
 * ou do nome em minúsculas se telefone não existir.
 */
export function getPatientKey(
  appointment?: Partial<Pick<Appointment, 'patient_phone' | 'patient_name' | 'patient_id'>> | null,
): string {
  if (!appointment || typeof appointment !== 'object') return ''

  if (
    appointment.patient_id &&
    typeof appointment.patient_id === 'string' &&
    appointment.patient_id.trim()
  ) {
    return `pid:${appointment.patient_id.trim()}`
  }
  const digits = cleanPhoneDigits(appointment.patient_phone || '')
  if (digits.length >= 8) {
    return `phone:${digits.slice(-8)}`
  }
  const rawName = typeof appointment.patient_name === 'string' ? appointment.patient_name : ''
  const name = rawName.trim().toLowerCase()
  if (name && name !== 'paciente sem nome' && name !== 'paciente' && name !== 'sem nome') {
    return `name:${name}`
  }
  const rawPhone = typeof appointment.patient_phone === 'string' ? appointment.patient_phone : ''
  if (name || rawPhone) {
    return `raw:${name || 'sem-nome'}_${rawPhone || ''}`
  }
  return 'unknown:sem-nome'
}

/**
 * Constrói um mapa pré-computado indexando todos os agendamentos por paciente
 * ordenados cronologicamente por starts_at.
 */
export function buildPatientAppointmentsMap(
  appointments: Appointment[],
): Map<string, Appointment[]> {
  const map = new Map<string, Appointment[]>()

  if (!Array.isArray(appointments)) return map

  for (const app of appointments) {
    if (!app || typeof app !== 'object') continue
    const key = getPatientKey(app)
    if (!key) continue
    const list = map.get(key)
    if (!list) {
      map.set(key, [app])
    } else {
      list.push(app)
    }
  }

  // Ordena cada histórico por starts_at crescente com tratamento seguro para timestamps
  for (const list of map.values()) {
    list.sort((a, b) => {
      const dateA = parseToDate(a?.starts_at)
      const dateB = parseToDate(b?.starts_at)
      const timeA = dateA ? dateA.getTime() : 0
      const timeB = dateB ? dateB.getTime() : 0
      if (timeA && timeB) return timeA - timeB
      if (timeA) return -1
      if (timeB) return 1
      return (a?.starts_at || '').localeCompare(b?.starts_at || '')
    })
  }

  return map
}

/**
 * Calcula se este agendamento é a 1ª consulta (primeira vez) e infere o tipo
 * caso não esteja definido ou precise ser derivado:
 * - Se vier preenchido como "Consultoria", preserva Consultoria.
 * - Se vier preenchido como "Retorno", preserva Retorno.
 * - Se vier preenchido como "Consulta" ou vazio:
 *     - se o paciente já tem agendamento anterior (realizado ou marcado em data anterior) → "Retorno"
 *     - senão → "Consulta" (1ª consulta / primeira vez)
 */
export function getAppointmentHistoryInfo(
  current: Appointment,
  patientMap: Map<string, Appointment[]>,
): PatientAppointmentHistoryInfo {
  if (!current || typeof current !== 'object') {
    return {
      inferredType: 'Consulta',
      isFirstConsultation: true,
      priorVisitsCount: 0,
    }
  }

  const rawType = (current.appointment_type || '').trim().toLowerCase()
  const key = getPatientKey(current)
  const history = key && patientMap ? patientMap.get(key) || [] : []

  // Agendamentos anteriores estritamente antes da data deste agendamento
  // Consideramos atendimentos que aconteceram antes (starts_at < current.starts_at) e não foram cancelados
  const currentDate = parseToDate(current.starts_at)
  const currentEpoch = currentDate && !isNaN(currentDate.getTime()) ? currentDate.getTime() : null
  const currentStartsAtStr = current.starts_at || ''

  const priorAppointments = history.filter((a) => {
    if (!a || a.id === current.id) return false
    if (a.status === 'cancelado') return false

    if (currentEpoch !== null) {
      const aDate = parseToDate(a.starts_at)
      if (aDate && !isNaN(aDate.getTime())) {
        return aDate.getTime() < currentEpoch
      }
    }
    // Fallback se uma das datas não puder ser parseada
    return currentStartsAtStr ? (a.starts_at || '') < currentStartsAtStr : false
  })

  // Agendamentos anteriores que foram efetivamente realizados ou confirmados
  const priorCompleted = priorAppointments.filter(
    (a) => a.status === 'realizado' || a.status === 'confirmado',
  )

  const isFirstConsultation = priorAppointments.length === 0

  let inferredType: InferredAppointmentType = 'Consulta'

  if (rawType.includes('consultoria')) {
    inferredType = 'Consultoria'
  } else if (rawType.includes('retorno') || rawType.includes('reavalia')) {
    inferredType = 'Retorno'
  } else if (rawType.includes('bioimped')) {
    inferredType = 'Bioimpedância'
  } else if (rawType.includes('consulta') || rawType.includes('primeira')) {
    // Se o backend marcou explicitamente como Consulta, mas já tem atendimento anterior realizado/agendado antes:
    if (!isFirstConsultation && priorCompleted.length > 0) {
      inferredType = 'Retorno'
    } else {
      inferredType = 'Consulta'
    }
  } else {
    // Tipo vazio ou desconhecido: inferir baseado no histórico
    if (!isFirstConsultation && (priorCompleted.length > 0 || priorAppointments.length > 0)) {
      inferredType = 'Retorno'
    } else {
      inferredType = 'Consulta'
    }
  }

  return {
    inferredType,
    isFirstConsultation,
    priorVisitsCount: priorAppointments.length,
  }
}
