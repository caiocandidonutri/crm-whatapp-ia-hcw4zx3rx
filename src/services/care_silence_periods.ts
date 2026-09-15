import pb from '@/lib/pocketbase/client'
import type { CareSilencePeriod } from '@/types/models'

/**
 * Horários de silêncio por dia da semana.
 *
 * A collection `care_silence_periods` mantém a estrutura original
 * (start_time / end_time / weekdays[] / enabled), mas esta tela agora
 * apresenta um grid Segunda→Domingo onde cada dia tem seu próprio
 * intervalo. Para preservar compatibilidade com os hooks de backend
 * (que já consultam essa collection com a estrutura antiga), cada dia
 * da semana é persistido como UM registro próprio com weekdays=[dia]
 * — exceto quando o intervalo é igual para todos os dias, caso em que
 * usamos um único registro com weekdays=[] (que o backend interpreta
 * como "todos os dias").
 */

export interface DaySilenceConfig {
  /** 0 = Domingo, 1 = Segunda, ..., 6 = Sábado */
  weekday: number
  enabled: boolean
  start_time: string
  end_time: string
}

export const WEEKDAY_LABELS = [
  { value: 0, short: 'Dom', long: 'Domingo' },
  { value: 1, short: 'Seg', long: 'Segunda' },
  { value: 2, short: 'Ter', long: 'Terça' },
  { value: 3, short: 'Qua', long: 'Quarta' },
  { value: 4, short: 'Qui', long: 'Quinta' },
  { value: 5, short: 'Sex', long: 'Sexta' },
  { value: 6, short: 'Sáb', long: 'Sábado' },
]

export async function getCareSilencePeriods(accountId: string): Promise<CareSilencePeriod[]> {
  return pb.collection('care_silence_periods').getFullList({
    filter: `account_id="${accountId}"`,
    sort: 'created',
    requestKey: null,
  })
}

/**
 * Carrega a configuração de silêncio como um mapa por dia da semana.
 * Registros com weekdays vazio (legado) são expandidos para todos os 7 dias.
 */
export async function getDaySilenceConfigs(accountId: string): Promise<DaySilenceConfig[]> {
  const periods = await getCareSilencePeriods(accountId)
  const byDay = new Map<number, DaySilenceConfig>()
  for (const p of periods) {
    const wd = p.weekdays || []
    const days = wd.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : wd
    for (const d of days) {
      if (!byDay.has(d)) {
        byDay.set(d, {
          weekday: d,
          enabled: p.enabled,
          start_time: p.start_time,
          end_time: p.end_time,
        })
      }
    }
  }
  const result: DaySilenceConfig[] = []
  for (let d = 0; d < 7; d++) {
    result.push(
      byDay.get(d) || {
        weekday: d,
        enabled: false,
        start_time: '22:00',
        end_time: '08:00',
      },
    )
  }
  return result
}

function sameInterval(a: DaySilenceConfig, b: DaySilenceConfig) {
  return a.enabled === b.enabled && a.start_time === b.start_time && a.end_time === b.end_time
}

/**
 * Salva a configuração por dia. Agrupa dias com o mesmo intervalo em um
 * único registro (ou em um registro "todos os dias" quando todos são
 * iguais), para manter a collection limpa e compatível com o backend.
 */
export async function saveDaySilenceConfigs(
  accountId: string,
  configs: DaySilenceConfig[],
): Promise<void> {
  // 1. Limpa registros antigos desta conta.
  const existing = await getCareSilencePeriods(accountId)
  await Promise.all(existing.map((p) => pb.collection('care_silence_periods').delete(p.id)))

  // 2. Agrupa dias por intervalo idêntico (enabled + start + end).
  const groups: DaySilenceConfig[][] = []
  const used = new Set<number>()
  for (const cfg of configs) {
    if (used.has(cfg.weekday)) continue
    const group = [cfg]
    used.add(cfg.weekday)
    for (const other of configs) {
      if (used.has(other.weekday)) continue
      if (sameInterval(cfg, other)) {
        group.push(other)
        used.add(other.weekday)
      }
    }
    groups.push(group)
  }

  // 3. Se TODOS os 7 dias têm o mesmo intervalo, salva como "todos os dias".
  if (groups.length === 1 && groups[0].length === 7) {
    const g = groups[0][0]
    await pb.collection('care_silence_periods').create({
      account_id: accountId,
      start_time: g.start_time,
      end_time: g.end_time,
      weekdays: [],
      enabled: g.enabled,
    })
    return
  }

  // 4. Caso contrário, salva um registro por grupo (com weekdays explícitos).
  for (const group of groups) {
    const g = group[0]
    await pb.collection('care_silence_periods').create({
      account_id: accountId,
      start_time: g.start_time,
      end_time: g.end_time,
      weekdays: group.map((c) => c.weekday),
      enabled: g.enabled,
    })
  }
}

// --- Funções legadas mantidas para compatibilidade ---
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
