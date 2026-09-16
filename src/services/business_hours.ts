import pb from '@/lib/pocketbase/client'
import type { BusinessHour } from '@/types/models'

export async function getBusinessHours(accountId: string): Promise<BusinessHour[]> {
  if (!accountId) return []
  try {
    return await pb.collection('business_hours').getFullList<BusinessHour>({
      filter: `account_id="${accountId}"`,
      sort: 'dia_semana',
      requestKey: null,
    })
  } catch (err) {
    console.error('Erro ao buscar horários de funcionamento:', err)
    return []
  }
}

export async function saveBusinessHour(
  accountId: string,
  dia_semana: number,
  ativo: boolean,
  abre: string,
  fecha: string,
  unidade = 'Global',
): Promise<BusinessHour> {
  try {
    const existing = await pb
      .collection('business_hours')
      .getFirstListItem<BusinessHour>(`account_id="${accountId}" && dia_semana=${dia_semana}`, {
        requestKey: null,
      })
    return await pb.collection('business_hours').update<BusinessHour>(existing.id, {
      ativo,
      abre,
      fecha,
      unidade,
    })
  } catch {
    return await pb.collection('business_hours').create<BusinessHour>({
      account_id: accountId,
      dia_semana,
      ativo,
      abre,
      fecha,
      unidade,
    })
  }
}
