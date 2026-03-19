import { invoke } from '@tauri-apps/api/core'

export interface FileContent {
  content: string
  size: number
  truncated: boolean
  encoding: string
}

export interface FileInfo {
  name: string
  path: string
  is_directory: boolean
  size: number
  modified: string
  permissions: string
}

export async function readFileContent(
  connectionId: string,
  path: string,
  maxSize?: number
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', {
    connectionId,
    path,
    maxSize: maxSize || 1024 * 1024,
  })
}

export async function writeFileContent(
  connectionId: string,
  path: string,
  content: string
): Promise<boolean> {
  return invoke<boolean>('write_file_content', {
    connectionId,
    path,
    content,
  })
}

export async function listDirectory(
  connectionId: string,
  path: string
): Promise<FileInfo[]> {
  return invoke<FileInfo[]>('list_directory', {
    connectionId,
    path,
  })
}

export async function fileExists(
  connectionId: string,
  path: string
): Promise<boolean> {
  return invoke<boolean>('file_exists', {
    connectionId,
    path,
  })
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}