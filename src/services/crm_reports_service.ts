import pb from '@/lib/pocketbase/client'

export interface ReportData {
  profileOverview: {
    totalContacts: number
    stageDistribution: Record<string, number>
    priorityDistribution: Record<string, number>
    patientClassification: { patients: number; nonPatients: number }
    categoryGroups: Array<{ id: string; name: string; count: number }>
    aiInsights: string
  }
  nextActions: Array<{
    contactId: string
    contactName: string
    action: string
    priority: number
    stage: string
    isPatient: boolean
  }>
  generatedAt: string
}

export const generateCrmReport = async (): Promise<ReportData> => {
  return pb.send<ReportData>('/backend/v1/crm/generate-report', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  })
}
