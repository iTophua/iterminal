import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockInvoke } from '../../test/setup'
import { Connection } from '../../types/shared'

vi.mock('../../config/constants', () => ({
  STORAGE_KEYS: {
    CONNECTIONS: 'iterminal_connections',
  },
}))

const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage })

describe('database service', () => {
  let database: typeof import('../database')

  beforeEach(async () => {
    vi.clearAllMocks()
    mockLocalStorage.clear()
    vi.resetModules()
    database = await import('../database')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initDatabase', () => {
    it('should call init_database command', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      
      const result = await database.initDatabase()
      
      expect(mockInvoke).toHaveBeenCalledWith('init_database')
      expect(result).toBe(true)
    })
  })

  describe('getConnections', () => {
    it('should return empty array when no connections', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce([])
      
      const result = await database.getConnections()
      
      expect(result).toEqual([])
    })

    it('should transform records to connections', async () => {
      const mockRecords = [
        {
          id: 'conn-1',
          name: 'Test Server',
          host: '192.168.1.1',
          port: 22,
          username: 'root',
          password: 'secret',
          group_name: 'Production',
          tags: '["tag1","tag2"]',
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
        },
      ]
      
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(mockRecords)
      
      const result = await database.getConnections()
      
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'conn-1',
        name: 'Test Server',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        password: 'secret',
        group: 'Production',
        tags: ['tag1', 'tag2'],
        status: 'offline',
      })
    })

    it('should handle null group and tags', async () => {
      const mockRecords = [
        {
          id: 'conn-1',
          name: 'Test',
          host: 'localhost',
          port: 22,
          username: 'user',
          password: null,
          group_name: null,
          tags: null,
          created_at: null,
          updated_at: null,
        },
      ]
      
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(mockRecords)
      
      const result = await database.getConnections()
      
      expect(result[0].group).toBe('默认')
      expect(result[0].tags).toEqual([])
      expect(result[0].password).toBeUndefined()
    })
  })

  describe('saveConnection', () => {
    it('should save connection with all fields', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(true)
      
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        password: 'secret',
        group: 'Production',
        tags: ['tag1'],
        status: 'offline',
      }
      
      const result = await database.saveConnection(conn)
      
      expect(mockInvoke).toHaveBeenLastCalledWith('save_connection', {
        connection: {
          id: 'conn-1',
          name: 'Test',
          host: '192.168.1.1',
          port: 22,
          username: 'root',
          password: 'secret',
          group_name: 'Production',
          tags: '["tag1"]',
          created_at: null,
          updated_at: null,
        },
      })
      expect(result).toBe(true)
    })

    it('should handle empty tags', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(true)
      
      const conn: Connection = {
        id: 'conn-1',
        name: 'Test',
        host: 'localhost',
        port: 22,
        username: 'user',
        group: '默认',
        tags: [],
        status: 'offline',
      }
      
      await database.saveConnection(conn)
      
      expect(mockInvoke).toHaveBeenLastCalledWith('save_connection', {
        connection: expect.objectContaining({
          tags: null,
        }),
      })
    })
  })

  describe('deleteConnection', () => {
    it('should delete connection by id', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(true)
      
      const result = await database.deleteConnection('conn-1')
      
      expect(mockInvoke).toHaveBeenLastCalledWith('delete_connection', { id: 'conn-1' })
      expect(result).toBe(true)
    })
  })

  describe('settings', () => {
    it('should get setting', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce('dark')
      
      const result = await database.getSetting('theme')
      
      expect(mockInvoke).toHaveBeenLastCalledWith('get_setting', { key: 'theme' })
      expect(result).toBe('dark')
    })

    it('should return null for missing setting', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(null)
      
      const result = await database.getSetting('missing')
      
      expect(result).toBeNull()
    })

    it('should save setting', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(true)
      
      const result = await database.saveSetting('theme', 'dark')
      
      expect(mockInvoke).toHaveBeenLastCalledWith('save_setting', { key: 'theme', value: 'dark' })
      expect(result).toBe(true)
    })
  })

  describe('import/export', () => {
    it('should export connections', async () => {
      const mockExportData = JSON.stringify({
        version: '1.0',
        exported_at: '2024-01-01',
        connections: [],
      })
      
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(mockExportData)
      
      const result = await database.exportConnections()
      
      expect(result).toBe(mockExportData)
    })

    it('should import connections with merge', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(5)
      
      const result = await database.importConnections('{"connections":[]}', true)
      
      expect(mockInvoke).toHaveBeenLastCalledWith('import_connections', {
        jsonData: '{"connections":[]}',
        merge: true,
      })
      expect(result).toBe(5)
    })
  })

  describe('migrateFromLocalStorage', () => {
    it('should return 0 when no data in localStorage', async () => {
      mockInvoke.mockResolvedValueOnce(true)
      
      const result = await database.migrateFromLocalStorage()
      
      expect(result).toBe(0)
    })

    it('should migrate connections and clear localStorage', async () => {
      const existingConns = [
        {
          id: 'conn-1',
          name: 'Test',
          host: 'localhost',
          port: 22,
          username: 'user',
          password: 'secret',
          group: '默认',
          tags: ['tag1'],
        },
      ]
      
      mockLocalStorage.setItem('iterminal_connections', JSON.stringify(existingConns))
      
      mockInvoke.mockResolvedValueOnce(true)
      mockInvoke.mockResolvedValueOnce(1)
      
      const result = await database.migrateFromLocalStorage()
      
      expect(result).toBe(1)
      expect(mockInvoke).toHaveBeenCalledWith('migrate_from_localstorage', {
        connectionsJson: expect.any(String),
      })
      expect(mockLocalStorage.getItem('iterminal_connections')).toBeNull()
    })
  })
})