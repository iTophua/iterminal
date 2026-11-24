import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// Node ≥22 的实验性 localStorage 全局（未启用时为 undefined）会遮蔽 jsdom 的实现，
// 导致模块作用域里的 localStorage.getItem 直接崩溃。补一个内存实现兜底。
if (!globalThis.localStorage) {
  const mem = new Map<string, string>()
  const storage: Storage = {
    get length() { return mem.size },
    clear: () => mem.clear(),
    getItem: (k) => mem.get(k) ?? null,
    key: (i) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k) => { mem.delete(k) },
    setItem: (k, v) => { mem.set(k, String(v)) },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}

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

// xterm 加载时会取 canvas 2d 上下文算对比度；jsdom 未实现，会往 stderr 报 Not implemented
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => null,
  configurable: true,
})

afterEach(() => {
  vi.clearAllMocks()
})

export { mockInvoke, mockListen, mockEmit }