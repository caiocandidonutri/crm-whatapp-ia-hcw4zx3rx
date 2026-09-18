import PocketBase from 'pocketbase'

// Instância PocketBase conectada ao backend da Skip Cloud
const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL)
pb.autoCancellation(false)

export default pb
