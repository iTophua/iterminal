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
  bypassed: boolean
  
  fetchLicense: () => Promise<void>
  verifyLicense: (key: string) => Promise<boolean>
  clearLicense: () => Promise<void>
  isFeatureAvailable: (feature: string) => boolean
  getMaxConnections: () => number
  setBypass: (bypass: boolean) => Promise<void>
  fetchBypassStatus: () => Promise<void>
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
  bypassed: false,

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
    if (get().bypassed) return true
    const info = get().licenseInfo || DEFAULT_LICENSE
    return info.features.includes(feature) || info.features.includes('*')
  },

  getMaxConnections: () => {
    if (get().bypassed) return 999
    const info = get().licenseInfo || DEFAULT_LICENSE
    return info.max_connections
  },

  setBypass: async (bypass: boolean) => {
    try {
      await invoke('set_license_bypass', { bypass })
      set({ bypassed: bypass })
    } catch (e) {
      console.error('Failed to set license bypass:', e)
    }
  },

  fetchBypassStatus: async () => {
    try {
      const bypassed = await invoke<boolean>('is_license_bypassed')
      set({ bypassed })
    } catch (e) {
      console.error('Failed to fetch bypass status:', e)
    }
  },
}))