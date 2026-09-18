// Diagnóstico de conectividade do PocketBase gerado no ciclo de recuperação
export interface PocketBaseHealthStatus {
  instanceId: string
  lastCheckTimestamp: string
  status: 'frozen' | 'recovering' | 'ready'
  lastError: string
  attemptsCount: number
}

export const PB_INSTANCE_STATUS: PocketBaseHealthStatus = {
  instanceId: 'conectado-whatsapp-app-copy-clone-clone-1c293',
  lastCheckTimestamp: new Date().toISOString(),
  status: 'frozen',
  lastError:
    'Instance did not become ready within timeout (fetch error: This operation was aborted)',
  attemptsCount: 3,
}
