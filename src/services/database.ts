import { invoke } from '@tauri-apps/api/core'
import { Connection } from '../types/shared'
import { STORAGE_KEYS } from '../config/constants'

interface ConnectionRecord {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string | null
  group_name: string | null
  tags: string | null
  created_at: string | null
  updated_at: string | null
}

function recordToConnection(record: ConnectionRecord): Connection {
  return {
    id: record.id,
    name: record.name,
    host: record.host,
    port: record.port,
    username: record.username,
    password: record.password || undefined,
    group: record.group_name || '默认',
    tags: record.tags ? JSON.parse(record.tags) : [],
    status: 'offline'
  }
}

function connectionToRecord(conn: Connection): ConnectionRecord {
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password || null,
    group_name: conn.group || null,
    tags: conn.tags.length > 0 ? JSON.stringify(conn.tags) : null,
    created_at: null,
    updated_at: null
  }
}

let initialized = false

export async function initDatabase(): Promise<boolean> {
  if (initialized) return true
  
  try {
    await invoke<boolean>('init_database')
    initialized = true
    return true
  } catch (error) {
    console.error('[Database] Failed to initialize:', error)
    throw error
  }
}

export async function getConnections(): Promise<Connection[]> {
  await initDatabase()
  
  const records = await invoke<ConnectionRecord[]>('get_connections')
  return records.map(recordToConnection)
}

export async function saveConnection(conn: Connection): Promise<boolean> {
  await initDatabase()
  
  const record = connectionToRecord(conn)
  return invoke<boolean>('save_connection', { connection: record })
}

export async function deleteConnection(id: string): Promise<boolean> {
  await initDatabase()
  
  return invoke<boolean>('delete_connection', { id })
}

export async function getSetting(key: string): Promise<string | null> {
  await initDatabase()
  
  return invoke<string | null>('get_setting', { key })
}

export async function saveSetting(key: string, value: string): Promise<boolean> {
  await initDatabase()
  
  return invoke<boolean>('save_setting', { key, value })
}

export async function exportConnections(): Promise<string> {
  await initDatabase()
  
  return invoke<string>('export_connections')
}

export async function importConnections(jsonData: string, merge: boolean): Promise<number> {
  await initDatabase()
  
  return invoke<number>('import_connections', { jsonData, merge })
}

export async function exportAllData(): Promise<string> {
  await initDatabase()
  
  return invoke<string>('export_all_data')
}

export async function importAllData(jsonData: string): Promise<number> {
  await initDatabase()
  
  return invoke<number>('import_all_data', { jsonData })
}

export async function migrateFromLocalStorage(): Promise<number> {
  await initDatabase()
  
  const saved = localStorage.getItem(STORAGE_KEYS.CONNECTIONS)
  if (!saved) return 0
  
  const connections = JSON.parse(saved)
  if (!Array.isArray(connections) || connections.length === 0) return 0
  
  const records: ConnectionRecord[] = connections.map((conn: Connection) => ({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password || null,
    group_name: conn.group || null,
    tags: conn.tags && conn.tags.length > 0 ? JSON.stringify(conn.tags) : null,
    created_at: null,
    updated_at: null
  }))
  
  const count = await invoke<number>('migrate_from_localstorage', {
    connectionsJson: JSON.stringify(records)
  })
  
  if (count > 0) {
    localStorage.removeItem(STORAGE_KEYS.CONNECTIONS)
  }
  
  return count
}

export function downloadExportFile(data: string, filename: string): void {
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function readImportFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}