import { invoke } from '@tauri-apps/api/core'

export interface Snippet {
  id: string
  title: string
  command: string
  description: string | null
  category: string | null
  created_at: number
  updated_at: number
  sort_order: number
}

/**
 * 命令片段库服务（Pro 功能 snippets）
 *
 * 数据存储在本地 SQLite，CRUD 通过 Tauri 命令访问。
 * Pro 控制点在 UI 层（isFeatureAvailable('snippets')），
 * 后端命令本身不校验 License——纯本地功能，接受一定盗版。
 */
export async function listSnippets(category?: string): Promise<Snippet[]> {
  return invoke<Snippet[]>('list_snippets', { category: category ?? null })
}

export async function saveSnippet(params: {
  id?: string
  title: string
  command: string
  description?: string
  category?: string
}): Promise<string> {
  return invoke<string>('save_snippet', {
    id: params.id ?? null,
    title: params.title,
    command: params.command,
    description: params.description ?? null,
    category: params.category ?? null,
  })
}

export async function deleteSnippet(id: string): Promise<boolean> {
  return invoke<boolean>('delete_snippet', { id })
}
