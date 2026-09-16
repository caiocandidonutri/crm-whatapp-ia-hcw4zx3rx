import { useState, useEffect, useCallback } from 'react'
import { useCurrentAccount } from '@/hooks/use-current-account'
import {
  getCareAlertSettings,
  toggleGlobalAutomations,
  type AutomationsToggleResult,
} from '@/services/care_alerts_service'
import { useRealtime } from '@/hooks/use-realtime'
import { toast } from 'sonner'

export function useAutomationsStatus() {
  const { accountId } = useCurrentAccount()
  const [paused, setPaused] = useState<boolean>(true) // default true (pausado por segurança)
  const [pausedAt, setPausedAt] = useState<string | null>(null)
  const [pausedBy, setPausedBy] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [toggling, setToggling] = useState<boolean>(false)

  const loadStatus = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        if (!accountId) {
          // Tentar carregar sem accountId ou primeira disponível
          const settings = await getCareAlertSettings('')
          if (settings) {
            setPaused(settings.global_automations_paused ?? true)
            setPausedAt(settings.global_automations_paused_at || null)
            setPausedBy(settings.global_automations_paused_by || '')
          }
          return
        }
        const settings = await getCareAlertSettings(accountId)
        if (settings) {
          setPaused(settings.global_automations_paused ?? true)
          setPausedAt(settings.global_automations_paused_at || null)
          setPausedBy(settings.global_automations_paused_by || '')
        } else {
          // Sem settings ainda criado, o padrão é true (pausado)
          setPaused(true)
        }
      } catch (err) {
        console.error('Erro ao carregar status das automações:', err)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [accountId],
  )

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Escutar mudanças em tempo real em care_alert_settings
  useRealtime('care_alert_settings', () => {
    loadStatus(true)
  })

  const setAutomationsPaused = useCallback(
    async (nextPaused: boolean): Promise<AutomationsToggleResult | null> => {
      setToggling(true)
      try {
        const res = await toggleGlobalAutomations(nextPaused, accountId || undefined)
        setPaused(res.paused)
        setPausedAt(res.paused_at)
        setPausedBy(res.paused_by)

        if (res.paused) {
          toast.warning('Mensagens automáticas pausadas. Nenhum disparo será feito aos pacientes.')
        } else {
          toast.success('Mensagens automáticas ativadas com sucesso!')
        }
        return res
      } catch (err: any) {
        console.error('Erro ao alternar automações:', err)
        toast.error('Não foi possível alterar o status das mensagens automáticas.')
        return null
      } finally {
        setToggling(false)
      }
    },
    [accountId],
  )

  const toggle = useCallback(async () => {
    return await setAutomationsPaused(!paused)
  }, [paused, setAutomationsPaused])

  return {
    paused,
    pausedAt,
    pausedBy,
    loading,
    toggling,
    toggle,
    setAutomationsPaused,
    refresh: loadStatus,
  }
}
