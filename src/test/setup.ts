import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

const mockInvoke = vi.fn()
const mockListen = vi.fn(() => Promise.resolve(() => {}))
const mockEmit = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
  listen: mockListen,
  emit: mockEmit,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
  emit: mockEmit,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

afterEach(() => {
  vi.clearAllMocks()
})

export { mockInvoke, mockListen, mockEmit }