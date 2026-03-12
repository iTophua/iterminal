import { useTransferStore } from '../stores/transferStore'

const calculateTimeToNextCleanup = (): number => {
  const now = new Date()
  const nextCleanup = new Date(now)
  nextCleanup.setHours(2, 0, 0, 0)
  
  if (now >= nextCleanup) {
    nextCleanup.setDate(nextCleanup.getDate() + 1)
  }
  
  return nextCleanup.getTime() - now.getTime()
}

export const setupNightlyCleanup = (): void => {
  const timeToFirstCleanup = calculateTimeToNextCleanup()
  
  setTimeout(() => {
    useTransferStore.getState().cleanupExpiredRecords()
    
    const dailyInterval = 24 * 60 * 60 * 1000
    setInterval(() => {
      useTransferStore.getState().cleanupExpiredRecords()
    }, dailyInterval)
  }, timeToFirstCleanup)
}