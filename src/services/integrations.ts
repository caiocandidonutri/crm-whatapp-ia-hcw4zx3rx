import pb from '@/lib/pocketbase/client'

export interface VapidConfigStatus {
  account_id: string
  is_owner: boolean
  is_connected: boolean
  has_public_key: boolean
  has_private_key: boolean
  public_key: string
  contact_email: string
}

export const getVapidStatus = async (): Promise<VapidConfigStatus> => {
  return pb.send<VapidConfigStatus>('/backend/v1/integrations/vapid', {
    method: 'GET',
    requestKey: null,
  })
}
