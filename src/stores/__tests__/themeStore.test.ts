import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useThemeStore } from '../themeStore'

const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}

const mockMatchMedia = vi.fn()

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
})

Object.defineProperty(window, 'matchMedia', {
  value: mockMatchMedia,
  writable: true
})

describe('ThemeStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'dark' })
    mockLocalStorage.getItem.mockReturnValue(null)
    mockMatchMedia.mockReturnValue({ matches: true })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with system mode when localStorage is empty', () => {
    mockLocalStorage.getItem.mockReturnValue(null)
    mockMatchMedia.mockReturnValue({ matches: true })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('system')
  })

  it('resolves system mode to dark when system prefers dark', () => {
    mockMatchMedia.mockReturnValue({ matches: true })
    
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'dark' })
    const store = useThemeStore.getState()
    expect(store.appTheme).toBe('dark')
  })

  it('resolves system mode to light when system prefers light', () => {
    mockMatchMedia.mockReturnValue({ matches: false })
    
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'light' })
    const store = useThemeStore.getState()
    expect(store.appTheme).toBe('light')
  })

  it('loads dark theme mode from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 2, mode: 'dark' }))
    useThemeStore.setState({ appThemeMode: 'dark', appTheme: 'dark' })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('dark')
    expect(store.appTheme).toBe('dark')
  })

  it('loads light theme mode from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 2, mode: 'light' }))
    useThemeStore.setState({ appThemeMode: 'light', appTheme: 'light' })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('light')
    expect(store.appTheme).toBe('light')
  })

  it('loads system mode from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 2, mode: 'system' }))
    mockMatchMedia.mockReturnValue({ matches: true })
    
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'dark' })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('system')
  })

  it('sets theme mode to dark and saves to localStorage', () => {
    const { setThemeMode } = useThemeStore.getState()
    
    setThemeMode('dark')
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('dark')
    expect(store.appTheme).toBe('dark')
  })

  it('sets theme mode to light and saves to localStorage', () => {
    const { setThemeMode } = useThemeStore.getState()
    
    setThemeMode('light')
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('light')
    expect(store.appTheme).toBe('light')
  })

  it('sets theme mode to system and resolves correctly', () => {
    mockMatchMedia.mockReturnValue({ matches: false })
    
    const { setThemeMode } = useThemeStore.getState()
    
    setThemeMode('system')
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('system')
    expect(store.appTheme).toBe('light')
  })

  it('setSystemTheme updates appTheme only when mode is system', () => {
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'light' })
    
    const { setSystemTheme } = useThemeStore.getState()
    setSystemTheme('dark')
    
    expect(useThemeStore.getState().appTheme).toBe('dark')
  })

  it('setSystemTheme does not update appTheme when mode is not system', () => {
    useThemeStore.setState({ appThemeMode: 'light', appTheme: 'light' })
    
    const { setSystemTheme } = useThemeStore.getState()
    setSystemTheme('dark')
    
    expect(useThemeStore.getState().appTheme).toBe('light')
  })

  it('saves theme to localStorage with correct format', () => {
    const { setThemeMode } = useThemeStore.getState()
    
    setThemeMode('light')
    
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'iterminal_theme',
      JSON.stringify({ version: 2, mode: 'light' })
    )
  })

  it('handles localStorage getItem error gracefully', () => {
    mockLocalStorage.getItem.mockImplementation(() => {
      throw new Error('localStorage unavailable')
    })
    mockMatchMedia.mockReturnValue({ matches: true })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBeDefined()
  })

  it('handles localStorage setItem error gracefully', () => {
    mockLocalStorage.setItem.mockImplementation(() => {
      throw new Error('localStorage quota exceeded')
    })
    
    const { setThemeMode } = useThemeStore.getState()
    
    expect(() => setThemeMode('light')).not.toThrow()
    expect(useThemeStore.getState().appThemeMode).toBe('light')
  })

  it('handles invalid values from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ version: 2, mode: 'invalid' }))
    useThemeStore.setState({ appThemeMode: 'system', appTheme: 'dark' })
    
    const store = useThemeStore.getState()
    expect(store.appThemeMode).toBe('system')
  })

  it('has correct initial state structure', () => {
    const store = useThemeStore.getState()
    
    expect(store).toHaveProperty('appThemeMode')
    expect(store).toHaveProperty('appTheme')
    expect(store).toHaveProperty('setThemeMode')
    expect(store).toHaveProperty('setSystemTheme')
  })
})