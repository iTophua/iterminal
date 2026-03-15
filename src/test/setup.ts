import '@testing-library/jest-dom'

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@tauri-apps/api', () => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
  unlisten: vi.fn()
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn()
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn()
}))