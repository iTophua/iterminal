/**
 * FileManager 子组件类型定义
 */

import type { DataNode } from 'antd/es/tree'

export interface TreeNode extends DataNode {
  key: string
  title: string
  isDirectory: boolean
  path: string
  size?: number
  modified?: string
  permissions?: string
  children?: TreeNode[]
}

export interface ConflictFile {
  localPath: string
  remotePath: string
  fileName: string
  targetDir: string
}

export interface FileManagerContextValue {
  connectionId: string
  currentPath: string
  selectedNode: TreeNode | null
  showHidden: boolean
  viewMode: 'tree' | 'list'
  refreshCurrent: () => void
  refreshDirectory: (path: string) => void
  message: { success: (msg: string) => void; error: (msg: string) => void; warning: (msg: string) => void; info: (msg: string) => void }
}

export interface ToolbarProps {
  currentPath: string
  onPathChange: (path: string) => void
  onNavigate: (path: string) => void
  showHidden: boolean
  onToggleHidden: () => void
  viewMode: 'tree' | 'list'
  onViewModeChange: (mode: 'tree' | 'list') => void
  onRefresh: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onUpload: () => void
  onUploadFolder: () => void
  loading: boolean
  onGoBack: () => void
  canGoBack: boolean
  onGoForward: () => void
  canGoForward: boolean
}

export interface FileItemActionsProps {
  selectedNode: TreeNode | null
  onDownload: () => void
  onUploadHere: () => void
  onDelete: () => void
  onRename: () => void
  onChmod: () => void
  onCompress: () => void
  onCopyPath: () => void
}