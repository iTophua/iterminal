import { createPortal } from 'react-dom'
import {
  ReloadOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  EyeOutlined,
  EditOutlined,
  FontColorsOutlined,
  LockOutlined,
  DownloadOutlined,
  UploadOutlined,
  CopyOutlined,
  ScissorOutlined,
  CompressOutlined,
  FileZipOutlined,
  UnorderedListOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { TreeNode } from './types'
import { isCompressedFile } from './utils'

interface ContextMenuItem {
  key: string
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  type?: 'item'
}

interface ContextMenuDivider {
  type: 'divider'
}

type ContextMenuItemType = ContextMenuItem | ContextMenuDivider

interface ContextMenuProps {
  visible: boolean
  position: { x: number; y: number }
  selectedNode: TreeNode | null
  onClose: () => void
  onRefresh: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onPreview: () => void
  onEdit: () => void
  onRename: () => void
  onChmod: () => void
  onDownload: () => void
  onUpload: () => void
  onUploadFolder: () => void
  onCopyName: () => void
  onCopyPath: () => void
  onCompress: () => void
  onExtract: () => void
  onDelete: () => void
}

export function ContextMenu({
  visible,
  position,
  selectedNode,
  onClose,
  onRefresh,
  onNewFile,
  onNewFolder,
  onPreview,
  onEdit,
  onRename,
  onChmod,
  onDownload,
  onUpload,
  onUploadFolder,
  onCopyName,
  onCopyPath,
  onCompress,
  onExtract,
  onDelete,
}: ContextMenuProps) {
  if (!visible) return null

  const items: ContextMenuItemType[] = [
    { key: 'refresh', label: '刷新', icon: <ReloadOutlined />, onClick: onRefresh, type: 'item' },
    { key: 'newFile', label: '新建文件', icon: <FileAddOutlined />, onClick: onNewFile, type: 'item' },
    { key: 'newFolder', label: '新建文件夹', icon: <FolderAddOutlined />, onClick: onNewFolder, type: 'item' },
    { type: 'divider' },
    {
      key: 'preview',
      label: '预览',
      icon: <EyeOutlined />,
      onClick: onPreview,
      disabled: selectedNode?.isDirectory,
      type: 'item',
    },
    {
      key: 'edit',
      label: '编辑',
      icon: <EditOutlined />,
      onClick: onEdit,
      disabled: selectedNode?.isDirectory,
      type: 'item',
    },
    { key: 'rename', label: '重命名', icon: <FontColorsOutlined />, onClick: onRename, type: 'item' },
    { key: 'chmod', label: '修改权限', icon: <LockOutlined />, onClick: onChmod, type: 'item' },
    { type: 'divider' },
    {
      key: 'download',
      label: '下载',
      icon: <DownloadOutlined />,
      onClick: onDownload,
      disabled: selectedNode?.isDirectory,
      type: 'item',
    },
    { key: 'upload', label: '上传文件', icon: <UploadOutlined />, onClick: onUpload, type: 'item' },
    { key: 'uploadFolder', label: '上传文件夹', icon: <FolderAddOutlined />, onClick: onUploadFolder, type: 'item' },
    { type: 'divider' },
    { key: 'copyName', label: '复制文件名', icon: <CopyOutlined />, onClick: onCopyName, type: 'item' },
    { key: 'copyPath', label: '复制绝对路径', icon: <ScissorOutlined />, onClick: onCopyPath, type: 'item' },
    { type: 'divider' },
    { key: 'compress', label: '压缩', icon: <FileZipOutlined />, onClick: onCompress, type: 'item' },
    {
      key: 'extract',
      label: '解压',
      icon: <UnorderedListOutlined />,
      onClick: onExtract,
      disabled: !selectedNode || selectedNode.isDirectory || !isCompressedFile(selectedNode.title || ''),
      type: 'item',
    },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, onClick: onDelete, danger: true, type: 'item' },
  ]

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: Math.min(position.y, window.innerHeight - 400),
        zIndex: 9999,
        background: 'var(--color-bg-elevated)',
        borderRadius: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        minWidth: 160,
        maxHeight: `calc(100vh - ${Math.min(position.y, window.innerHeight - 400) + 20}px)`,
        overflowY: 'auto',
      }}
    >
      {items.map((item, index) =>
        item.type === 'divider' ? (
          <div key={`divider-${index}`} style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
        ) : (
          <div
            key={item.key}
            style={{
              padding: '8px 12px',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              color: item.disabled
                ? 'var(--color-text-quaternary)'
                : item.danger
                  ? '#ff4d4f'
                  : 'var(--color-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              opacity: item.disabled ? 0.5 : 1,
              transition: 'background 0.15s',
            }}
            onClick={item.disabled ? undefined : (e) => {
              e.stopPropagation()
              item.onClick()
              onClose()
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = 'rgba(0, 185, 107, 0.15)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {item.icon}
            {item.label}
          </div>
        )
      )}
    </div>,
    document.body
  )
}