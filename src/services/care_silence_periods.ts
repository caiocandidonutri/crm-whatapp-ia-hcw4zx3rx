import pb from '@/lib/pocketbase/client'
import type { CareSilencePeriod } from '@/types/models'

export async function getCareSilencePeriods(accountId: string): Promise<CareSilencePeriod[]> {
  return pb.collection('care_silence_periods').getFullList({
    filter: `account_id="${accountId}"`,
    sort: 'created',
  })
}

export async function createCareSilencePeriod(
  accountId: string,
  data: { start_time: string; end_time: string; weekdays: number[]; enabled: boolean },
): Promise<CareSilencePeriod> {
  return pb.collection('care_silence_periods').create({ ...data, account_id: accountId })
}

export async function updateCareSilencePeriod(
  id: string,
  data: { start_time?: string; end_time?: string; weekdays?: number[]; enabled?: boolean },
): Promise<CareSilencePeriod> {
  return pb.collection('care_silence_periods').update(id, data)
}

export async function deleteCareSilencePeriod(id: string): Promise<void> {
  await pb.collection('care_silence_periods').delete(id)
}
