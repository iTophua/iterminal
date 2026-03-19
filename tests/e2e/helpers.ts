import { Page } from '@playwright/test'

export async function mockTauriApi(page: Page) {
  await page.addInitScript(() => {
    const mockConnections = [
      {
        id: 'conn-1',
        name: 'Test Server 1',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        password: 'secret',
        group_name: 'Production',
        tags: '["web","api"]',
        created_at: null,
        updated_at: null,
      },
      {
        id: 'conn-2',
        name: 'Test Server 2',
        host: '192.168.1.2',
        port: 22,
        username: 'admin',
        password: 'password',
        group_name: 'Development',
        tags: '["dev"]',
        created_at: null,
        updated_at: null,
      },
    ]

    const mockInvoke = async (cmd: string, args?: Record<string, unknown>) => {
      console.log('[Mock] invoke:', cmd)
      switch (cmd) {
        case 'init_database':
          return true
        case 'get_connections':
          return mockConnections
        case 'save_connection': {
          const newConn = args?.connection as Record<string, unknown>
          if (newConn) {
            const existingIdx = mockConnections.findIndex(c => c.id === newConn.id)
            if (existingIdx > -1) {
              mockConnections[existingIdx] = newConn as never
            } else {
              mockConnections.push(newConn as never)
            }
          }
          return true
        }
        case 'delete_connection': {
          const idx = mockConnections.findIndex(c => c.id === args?.id)
          if (idx > -1) mockConnections.splice(idx, 1)
          return true
        }
        case 'export_connections':
          return JSON.stringify({
            version: '1.0',
            exported_at: new Date().toISOString(),
            connections: mockConnections,
          })
        case 'import_connections':
          return 1
        case 'migrate_from_localstorage':
          return 0
        case 'check_port_reachable':
          return false
        case 'test_connection':
          return true
        case 'connect_ssh':
          return true
        case 'get_shell':
          return 'shell-' + Date.now()
        case 'get_monospace_fonts':
          return ['Menlo', 'Monaco', 'Courier New']
        case 'get_setting':
          return null
        case 'save_setting':
          return true
        default:
          console.log('[Mock] Unhandled invoke:', cmd, args)
          return null
      }
    }

    // @ts-expect-error mock
    window.__TAURI_INTERNALS__ = {
      invoke: mockInvoke,
    }

    // @ts-expect-error mock
    window.__TAURI__ = {
      core: {
        invoke: mockInvoke,
        listen: async () => () => {},
        emit: async () => {},
      },
      event: {
        listen: async () => () => {},
        emit: async () => {},
      },
    }

    const originalFetch = window.fetch
    window.fetch = async (input, init) => {
      if (typeof input === 'string' && input.includes('127.0.0.1:27149')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }
  })
}

export async function waitForAppReady(page: Page) {
  await page.waitForSelector('.ant-layout', { timeout: 30000 })
  await page.waitForTimeout(2000)
}