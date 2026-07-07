import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type LicenseType = 'Free' | 'Pro' | 'Enterprise'

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

/**
 * 免费版默认信息。
 *
 * 仅在后端 get_license 调用失败（异常）时作为兜底，
 * 保证应用在 Pro 构建未正确注入 license 时仍能以 Free 模式运行。
 */
const FREE_FALLBACK: LicenseInfo = {
  license_type: 'Free',
  expires_at: null,
  features: [
    'basic_ssh',
    'basic_sftp',
    'basic_monitor',
    'terminal_links',
    'folder_download',
    'file_copy_move',
    'broadcast_input',
    'proxy_jump',
    'themes',
  ],
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
      // 后端调用失败时回退 Free，避免阻塞应用启动
      set({
        licenseInfo: FREE_FALLBACK,
        loading: false,
        error: e as string,
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
      set({ licenseInfo: FREE_FALLBACK, error: null })
    } catch (e) {
      set({ error: e as string })
    }
  },

  isFeatureAvailable: (feature: string) => {
    const info = get().licenseInfo || FREE_FALLBACK
    return info.features.includes(feature) || info.features.includes('*')
  },

  getMaxConnections: () => {
    const info = get().licenseInfo || FREE_FALLBACK
    return info.max_connections
  },
}))
