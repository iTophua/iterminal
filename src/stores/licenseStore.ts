import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type LicenseType = 'Free' | 'Personal' | 'Professional' | 'Enterprise'

export interface LicenseInfo {
  license_type: LicenseType
  expires_at: string | null
  features: string[]
  is_valid: boolean
  max_connections: number
  email: string | null
}

interface LicenseState {
  licenseInfo: LicenseInfo | null
  loading: boolean
  error: string | null
  
  fetchLicense: () => Promise<void>
  verifyLicense: (key: string) => Promise<boolean>
  clearLicense: () => Promise<void>
  isFeatureAvailable: (feature: string) => boolean
  getMaxConnections: () => number
}

const DEFAULT_LICENSE: LicenseInfo = {
  license_type: 'Free',
  expires_at: null,
  features: ['basic_ssh', 'basic_sftp', 'basic_monitor'],
  is_valid: true,
  max_connections: 3,
  email: null,
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  licenseInfo: null,
  loading: false,
  error: null,

  fetchLicense: async () => {
    set({ loading: true, error: null })
    try {
      const info = await invoke<LicenseInfo>('get_license')
      set({ licenseInfo: info, loading: false })
    } catch (e) {
      set({ 
        licenseInfo: DEFAULT_LICENSE, 
        loading: false,
        error: e as string 
      })
    }
  },

  verifyLicense: async (key: string) => {
    set({ loading: true, error: null })
    try {
      const info = await invoke<LicenseInfo>('verify_license', { key })
      set({ licenseInfo: info, loading: false })
      return true
    } catch (e) {
      set({ loading: false, error: e as string })
      return false
    }
  },

  clearLicense: async () => {
    try {
      await invoke('clear_license')
      set({ licenseInfo: DEFAULT_LICENSE, error: null })
    } catch (e) {
      set({ error: e as string })
    }
  },

  isFeatureAvailable: (feature: string) => {
    const info = get().licenseInfo || DEFAULT_LICENSE
    return info.features.includes(feature) || info.features.includes('*')
  },

  getMaxConnections: () => {
    const info = get().licenseInfo || DEFAULT_LICENSE
    return info.max_connections
  },
}))