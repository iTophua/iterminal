import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Tree, Input, Button, Tooltip, Modal, Empty, Spin, App
} from 'antd'
const { DirectoryTree } = Tree
import {
  HomeOutlined, ReloadOutlined,
  UploadOutlined, DownloadOutlined, DeleteOutlined, EditOutlined,
  FolderAddOutlined, FileAddOutlined, ScissorOutlined,
  CopyOutlined, CompressOutlined, EyeOutlined, EyeInvisibleOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, CloudUploadOutlined,
  ExclamationCircleOutlined, UnorderedListOutlined, PartitionOutlined,
  ArrowUpOutlined, ArrowDownOutlined, FolderOutlined, FileOutlined
} from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { DataNode } from 'antd/es/tree'
import { useTerminalStore } from '../stores/terminalStore'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useTransferStore } from '../stores/transferStore'

interface FileManagerPanelProps {
  connectionId: string
  visible: boolean
  onClose: () => void
}

interface TreeNode extends DataNode {
  key: string
  title: string
  isDirectory: boolean
  path: string
  size?: number
  modified?: string
  permissions?: string
  children?: TreeNode[]
}

interface ConflictFile {
  localPath: string
  remotePath: string
  fileName: string
  targetDir: string
}

export default function FileManagerPanel({ connectionId, visible, onClose }: FileManagerPanelProps) {
  const { message } = App.useApp()
  const store = useTerminalStore()
  const connection = store.connectedConnections.find(c => c.connectionId === connectionId)?.connection
  const currentPath = store.currentPaths[connectionId] || '/'
  const expandedKeys = store.expandedKeys[connectionId] || []

  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const treeDataRef = useRef<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const loadingPathsRef = useRef<Set<string>>(new Set())
  
  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [contextMenuVisible, setContextMenuVisible] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [pathInput, setPathInput] = useState(currentPath)
  const [showHidden, setShowHidden] = useState(false)

  const [newFileVisible, setNewFileVisible] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFolderVisible, setNewFolderVisible] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renameVisible, setRenameVisible] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteVisible, setDeleteVisible] = useState(false)
  const [chmodVisible, setChmodVisible] = useState(false)
  const [chmodValue, setChmodValue] = useState('644')
  const [compressVisible, setCompressVisible] = useState(false)
  const [compressName, setCompressName] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'tree' | 'list'>(() => {
    const saved = localStorage.getItem('iterminal_file_view_mode')
    return (saved === 'list' || saved === 'tree') ? saved : 'tree'
  })
  const [sortField, setSortField] = useState<'name' | 'size' | 'modified' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragTargetPathRef = useRef<string | null>(null)

  const [conflictModalVisible, setConflictModalVisible] = useState(false)
  const [conflictFile, setConflictFile] = useState<ConflictFile | null>(null)
  const conflictResolvePromiseRef = useRef<{ resolve: (action: 'overwrite' | 'skip' | 'rename') => void } | null>(null)

  useEffect(() => {
    dragTargetPathRef.current = dragTargetPath
  }, [dragTargetPath])

  const uploadFileRef = useRef<typeof uploadFile | null>(null)
  const uploadFolderRef = useRef<typeof uploadFolder | null>(null)
  const refreshCurrentRef = useRef<typeof refreshCurrent | null>(null)
  const refreshDirectoryRef = useRef<typeof refreshDirectory | null>(null)

  const mapFilesToNodes = useCallback((files: any[]): TreeNode[] => {
    const filteredFiles = showHidden ? files : files.filter(f => !f.name.startsWith('.'))
    return filteredFiles.map(file => ({
      key: file.path,
      title: file.name,
      isDirectory: file.is_directory,
      path: file.path,
      size: file.size,
      modified: file.modified,
      permissions: file.permissions,
      isLeaf: !file.is_directory,
    }))
  }, [showHidden])

  const updateTreeData = useCallback((list: TreeNode[], parentPath: string, children: TreeNode[]): TreeNode[] => {
    return list.map(node => {
      if (node.path === parentPath) {
        return { ...node, children }
      }
      if (node.children) {
        return { ...node, children: updateTreeData(node.children, parentPath, children) }
      }
      return node
    })
  }, [])

  const loadDirectory = useCallback(async (path: string, isRoot = false) => {
    if (!connectionId) return
    if (loadingPathsRef.current.has(path)) return
    loadingPathsRef.current.add(path)

    if (isRoot) {
      setLoading(true)
    }
    try {
      const files: any[] = await invoke('list_directory', { connectionId, path })
      const nodes = mapFilesToNodes(files)
      if (isRoot) {
        setTreeData(nodes)
        if (path !== '/') {
          store.setExpandedKeys(connectionId, [path])
        }
      } else {
        setTreeData(prev => updateTreeData(prev, path, nodes))
      }
      loadingPathsRef.current.delete(path)
    } catch (err) {
      message.error(`加载目录失败: ${err}`)
      loadingPathsRef.current.delete(path)
    } finally {
      if (isRoot) {
        setLoading(false)
      }
    }
  }, [connectionId, mapFilesToNodes, message, store.setExpandedKeys, updateTreeData])

  useEffect(() => {
    if (visible && connectionId) {
      loadDirectory(currentPath, true)
      setPathInput(currentPath)
      setSelectedKeys([currentPath])
    }
  }, [visible, connectionId, currentPath, loadDirectory])

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenuVisible) {
        setContextMenuVisible(false)
      }
    }
    if (contextMenuVisible) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenuVisible])

  const findNodeByPath = (nodes: TreeNode[], path: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children) {
        const found = findNodeByPath(node.children, path)
        if (found) return found
      }
    }
    return null
  }

  const onExpand: any = (keys: React.Key[], info: any) => {
    store.setExpandedKeys(connectionId, keys as string[])
    if (info.expanded && info.node && !info.node.isLeaf) {
      const node = findNodeByPath(treeDataRef.current, info.node.key as string)
      if (node && !node.children) {
        loadDirectory(node.path, false)
      }
    }
  }

  const onLoadData = async (_treeNode: any): Promise<void> => {
  }

  const onSelect = (keys: React.Key[], info: any) => {
    setSelectedKeys(keys as string[])
    setSelectedNode(info.node as TreeNode)
  }

  const onPathInputPressEnter = () => {
    const newPath = pathInput.trim()
    if (newPath) {
      loadDirectory(newPath, true)
    }
  }

  const goHome = () => {
    const homePath = '/home/' + (connection?.username || '')
    store.setCurrentPath(connectionId, homePath)
    loadDirectory(homePath, true)
  }

  const refreshCurrent = async () => {
    const targetPath = viewMode === 'list' 
      ? currentPath 
      : (selectedNode?.isDirectory ? selectedNode.path : currentPath)
    try {
      const files: any[] = await invoke('list_directory', { connectionId, path: targetPath })
      const nodes = mapFilesToNodes(files)
      if (viewMode === 'list') {
        setTreeData(nodes)
      } else {
        const isRootPath = targetPath === currentPath && !treeData.some(n => n.path === targetPath)
        if (isRootPath) {
          setTreeData(nodes)
        } else {
          setTreeData(prev => updateTreeData(prev, targetPath, nodes))
        }
      }
    } catch (err) {
      message.error(`刷新失败: ${err}`)
    }
  }
  refreshCurrentRef.current = refreshCurrent

  const refreshDirectory = async (dirPath: string) => {
    try {
      const files: any[] = await invoke('list_directory', { connectionId, path: dirPath })
      const nodes = mapFilesToNodes(files)
      if (viewMode === 'list') {
        if (dirPath === currentPath) {
          setTreeData(nodes)
        }
      } else {
        setTreeData(prev => updateTreeData(prev, dirPath, nodes))
      }
    } catch (err) {
      message.error(`刷新失败: ${err}`)
    }
  }
  refreshDirectoryRef.current = refreshDirectory

  const onTreeRightClick = (info: { event: React.MouseEvent; node: TreeNode }) => {
    const { event, node } = info
    event.preventDefault()
    setSelectedNode(node)
    setSelectedKeys([node.key])
    setContextMenuPos({ x: event.clientX, y: event.clientY })
    setContextMenuVisible(true)
  }

const renderTreeNode = (node: TreeNode) => (
    <span
      data-dir-path={node.isDirectory ? node.path : undefined}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        color: node.isDirectory ? '#00b96b' : '#CCC',
      }}
    >
      {node.title}
      {!node.isDirectory && node.size !== undefined && node.size > 0 && (
        <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
          {formatSize(node.size)}
        </span>
      )}
    </span>
  )

  useEffect(() => {
    if (viewMode !== 'tree') return

    const container = treeContainerRef.current
    if (!container) return

    const removeTitles = () => {
      const wrappers = container.querySelectorAll('.ant-tree-node-content-wrapper')
      wrappers.forEach((wrapper) => {
        wrapper.setAttribute('title', '')
      })
    }

    removeTitles()

    const interval = setInterval(removeTitles, 100)

    const observer = new MutationObserver(removeTitles)

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title'],
    })

    return () => {
      clearInterval(interval)
      observer.disconnect()
    }
  }, [viewMode])

  useEffect(() => {
    const container = treeContainerRef.current
    if (!container) return

    container.querySelectorAll('.ant-tree-treenode').forEach((node) => {
      node.classList.remove('drop-target')
    })

    if (isDragOver && dragTargetPath) {
      const targetNode = container.querySelector(`[data-dir-path="${dragTargetPath}"]`)
      if (targetNode) {
        const treeNode = targetNode.closest('.ant-tree-treenode')
        if (treeNode) {
          treeNode.classList.add('drop-target')
        }
      }
    }
  }, [isDragOver, dragTargetPath])

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const checkFileConflict = async (remotePath: string): Promise<boolean> => {
    try {
      return await invoke('file_exists', { connectionId, path: remotePath })
    } catch (err) {
      console.error('检查文件是否存在失败:', err)
      return false
    }
  }

  const generateUniqueFileName = async (baseName: string, extension: string, targetDir: string): Promise<string> => {
    let counter = 1
    const maxAttempts = 100
    while (counter <= maxAttempts) {
      const newName = `${baseName}_${counter}${extension}`
      const remotePath = targetDir + '/' + newName
      const exists = await checkFileConflict(remotePath)
      if (!exists) {
        return newName
      }
      counter++
    }
    return `${baseName}_${Date.now()}${extension}`
  }

  const showConflictDialog = async (fileInfo: ConflictFile): Promise<'overwrite' | 'skip' | 'rename'> => {
    return new Promise((resolve) => {
      setConflictFile(fileInfo)
      conflictResolvePromiseRef.current = { resolve }
      setConflictModalVisible(true)
    })
  }

  const resolveConflictDialog = (action: 'overwrite' | 'skip' | 'rename') => {
    setConflictModalVisible(false)
    if (conflictResolvePromiseRef.current) {
      conflictResolvePromiseRef.current.resolve(action)
      conflictResolvePromiseRef.current = null
    }
  }

  const handleUploadFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: '选择要上传的文件',
      })
      if (selected && Array.isArray(selected) && selected.length > 0) {
        const targetDir = (selectedNode?.isDirectory && selectedNode?.path) || currentPath
        for (const filePath of selected) {
          const fileName = filePath.split('/').pop() || 'file'
          const remotePath = targetDir + '/' + fileName
          await uploadFile(filePath, remotePath, fileName)
        }
        refreshCurrent()
      }
    } catch (err) {
      console.error('上传失败:', err)
    }
  }

  const handleUploadFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择要上传的文件夹',
      })
      if (selected) {
        const targetDir = (selectedNode?.isDirectory && selectedNode?.path) || currentPath
        const folderName = selected.split('/').pop() || 'folder'
        let remotePath = targetDir + '/' + folderName

        const exists = await checkFileConflict(remotePath)
        if (exists) {
          const action = await showConflictDialog({
            localPath: selected,
            remotePath,
            fileName: folderName,
            targetDir
          })

          if (action === 'skip') {
            return
          } else if (action === 'rename') {
            const newFolderName = await generateUniqueFileName(folderName, '', targetDir)
            remotePath = targetDir + '/' + newFolderName
            await uploadFolder(selected, remotePath, newFolderName)
            refreshCurrent()
            return
          }
        }

        await uploadFolder(selected, remotePath, folderName)
        refreshCurrent()
      }
    } catch (err) {
      console.error('上传文件夹失败:', err)
    }
  }

  const uploadFile = async (localPath: string, remotePath: string, fileName: string, targetDir?: string) => {
    const dir = targetDir || remotePath.substring(0, remotePath.lastIndexOf('/'))

    const exists = await checkFileConflict(remotePath)
    if (exists) {
      const action = await showConflictDialog({
        localPath,
        remotePath,
        fileName,
        targetDir: dir
      })

      if (action === 'skip') {
        return
      } else if (action === 'rename') {
        const lastDotIndex = fileName.lastIndexOf('.')
        let baseName = fileName
        let extension = ''
        if (lastDotIndex > 0) {
          baseName = fileName.substring(0, lastDotIndex)
          extension = fileName.substring(lastDotIndex)
        }
        const newFileName = await generateUniqueFileName(baseName, extension, dir)
        const newRemotePath = dir + '/' + newFileName
        performUpload(localPath, newRemotePath, newFileName, dir)
        return
      }
    }

    performUpload(localPath, remotePath, fileName, dir)
  }

  const performUpload = async (localPath: string, remotePath: string, fileName: string, targetDir: string) => {
    const taskId = Date.now().toString() + Math.random().toString(36).substring(2, 11)
    const now = Date.now()
    const conn = connection

    useTransferStore.getState().addRecord({
      id: taskId,
      connectionId,
      connectionName: conn?.name || 'Unknown',
      connectionHost: conn?.host || '',
      type: 'upload',
      localPath,
      remotePath,
      fileName,
      fileSize: 0,
      transferred: 0,
      status: 'pending',
      startTime: now,
    })

    useTransferStore.getState().updateRecord(taskId, { status: 'transferring' })

    listen<{ transferred: number; total: number; totalFiles?: number; completedFiles?: number }>(
      `transfer-progress-${taskId}`,
      (event) => {
        useTransferStore.getState().updateProgress(taskId, event.payload.transferred, event.payload.total, event.payload.totalFiles, event.payload.completedFiles)
      }
    ).then((unlistenProgress) => {
      listen<{ success: boolean; cancelled: boolean; error?: string }>(
        `transfer-complete-${taskId}`,
        (event) => {
          unlistenProgress()
          const result = event.payload
          if (result.cancelled) {
            useTransferStore.getState().updateRecord(taskId, { status: 'cancelled', endTime: Date.now() })
          } else if (result.success) {
            useTransferStore.getState().updateRecord(taskId, { status: 'completed', endTime: Date.now() })
            message.success(`上传完成: ${fileName}`)
            refreshDirectoryRef.current?.(targetDir)
          } else {
            useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: result.error || 'Unknown error' })
            message.error(`上传失败: ${result.error}`)
          }
        }
      ).then((unlistenComplete) => {
        invoke('upload_file', { taskId, connectionId, localPath, remotePath }).catch((err) => {
          unlistenProgress()
          unlistenComplete()
          useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
          message.error(`上传失败: ${err}`)
        })
      })
    })
  }
  uploadFileRef.current = uploadFile

  const uploadFolder = async (localPath: string, remotePath: string, folderName: string, targetDir?: string) => {
    const taskId = Date.now().toString() + Math.random().toString(36).substring(2, 11)
    const now = Date.now()
    const conn = connection
    const dir = targetDir || remotePath.substring(0, remotePath.lastIndexOf('/'))

    useTransferStore.getState().addRecord({
      id: taskId,
      connectionId,
      connectionName: conn?.name || 'Unknown',
      connectionHost: conn?.host || '',
      type: 'upload',
      localPath,
      remotePath,
      fileName: folderName,
      fileSize: 0,
      transferred: 0,
      status: 'pending',
      startTime: now,
    })

    useTransferStore.getState().updateRecord(taskId, { status: 'transferring' })

    listen<{ transferred: number; total: number; totalFiles?: number; completedFiles?: number }>(
      `transfer-progress-${taskId}`,
      (event) => {
        useTransferStore.getState().updateProgress(taskId, event.payload.transferred, event.payload.total, event.payload.totalFiles, event.payload.completedFiles)
      }
    ).then((unlisten) => {
      invoke<{ success: boolean; cancelled: boolean }>('upload_folder', { taskId, connectionId, localPath, remotePath })
        .then((result) => {
          if (result.cancelled) {
            useTransferStore.getState().updateRecord(taskId, { status: 'cancelled', endTime: Date.now() })
          } else {
            useTransferStore.getState().updateRecord(taskId, { status: 'completed', endTime: Date.now() })
            message.success(`上传完成: ${folderName}`)
            refreshDirectoryRef.current?.(dir)
          }
        })
        .catch((err) => {
          useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
          message.error(`上传失败: ${err}`)
        })
        .finally(() => unlisten())
    })
  }
  uploadFolderRef.current = uploadFolder

  useEffect(() => {
    if (!visible || !connectionId) return

    let unlisten: (() => void) | null = null

    const handleDrop = async (paths: string[]) => {
      const targetDir = dragTargetPathRef.current || ((selectedNode?.isDirectory && selectedNode?.path) || currentPath)

      for (const localPath of paths) {
        try {
          const isDir = await invoke<boolean>('is_local_directory', { path: localPath })
          const fileName = localPath.split('/').pop() || 'file'
          const remotePath = targetDir + '/' + fileName

          if (isDir) {
            uploadFolderRef.current?.(localPath, remotePath, fileName)
          } else {
            uploadFileRef.current?.(localPath, remotePath, fileName)
          }
        } catch (err) {
          message.error(`上传失败: ${err}`)
        }
      }
      setDragTargetPath(null)
    }

    const setupListeners = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const panel = panelRef.current
        const checkInPanel = (x: number, y: number) => {
          if (!panel) return false
          const panelRect = panel.getBoundingClientRect()
          return x >= panelRect.left && x <= panelRect.right && y >= panelRect.top && y <= panelRect.bottom
        }

        if (event.payload.type === 'enter') {
          const { position } = event.payload
          if (checkInPanel(position.x, position.y - 24)) {
            setIsDragOver(true)
          }
        } else if (event.payload.type === 'leave') {
          setIsDragOver(false)
          setDragTargetPath(null)
        } else if (event.payload.type === 'over') {
          const { position } = event.payload
          const x = position.x
          const y = position.y - 24

          const container = treeContainerRef.current
          if (!panel || !container || !checkInPanel(x, y)) {
            setDragTargetPath(null)
            setIsDragOver(false)
            return
          }

          setIsDragOver(true)

          const allNodes = viewMode === 'list'
            ? container.querySelectorAll('.file-list-item')
            : container.querySelectorAll('.ant-tree-treenode')
          let foundPath: string | null = null

          allNodes.forEach((node) => {
            const rect = node.getBoundingClientRect()
            const inRow = y >= rect.top && y <= rect.bottom
            if (inRow) {
              if (viewMode === 'list') {
                foundPath = node.getAttribute('data-dir-path')
              } else {
                const dirElement = node.querySelector('[data-dir-path]')
                if (dirElement) {
                  foundPath = dirElement.getAttribute('data-dir-path')
                }
              }
            }
          })

          setDragTargetPath(foundPath)
        } else if (event.payload.type === 'drop') {
          setIsDragOver(false)
          const { paths, position } = event.payload

          if (!paths || paths.length === 0) {
            setDragTargetPath(null)
            return
          }

          if (!checkInPanel(position.x, position.y - 24)) {
            setDragTargetPath(null)
            return
          }

          handleDrop(paths)
        }
      })
    }

    setupListeners()

    return () => {
      unlisten?.()
    }
  }, [visible, connectionId, currentPath, selectedNode, message, viewMode])

  const handleDownload = async (remotePath: string, fileName: string) => {
    try {
      const savePath = await save({
        defaultPath: fileName,
        title: '保存文件',
      })
      if (savePath) {
        const taskId = Date.now().toString() + Math.random().toString(36).substring(2, 11)
        const now = Date.now()
        const conn = connection

        useTransferStore.getState().addRecord({
          id: taskId,
          connectionId,
          connectionName: conn?.name || 'Unknown',
          connectionHost: conn?.host || '',
          type: 'download',
          localPath: savePath,
          remotePath,
          fileName,
          fileSize: 0,
          transferred: 0,
          status: 'pending',
          startTime: now,
        })

        useTransferStore.getState().updateRecord(taskId, { status: 'transferring' })

        listen<{ transferred: number; total: number }>(
          `transfer-progress-${taskId}`,
          (event) => {
            useTransferStore.getState().updateProgress(taskId, event.payload.transferred, event.payload.total)
          }
        ).then((unlistenProgress) => {
          listen<{ success: boolean; cancelled: boolean; error?: string }>(
            `transfer-complete-${taskId}`,
            (event) => {
              unlistenProgress()
              const result = event.payload
              if (result.cancelled) {
                useTransferStore.getState().updateRecord(taskId, { status: 'cancelled', endTime: Date.now() })
              } else if (result.success) {
                useTransferStore.getState().updateRecord(taskId, { status: 'completed', endTime: Date.now() })
                message.success(`下载完成: ${fileName}`)
              } else {
                useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: result.error || 'Unknown error' })
                message.error(`下载失败: ${result.error}`)
              }
            }
          ).then((unlistenComplete) => {
            invoke('download_file', { taskId, connectionId, remotePath, localPath: savePath }).catch((err) => {
              unlistenProgress()
              unlistenComplete()
              useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
              message.error(`下载失败: ${err}`)
            })
          })
        })
      }
    } catch (err) {
      console.error('保存对话框取消:', err)
    }
  }

  const handleDownloadSelected = () => {
    if (!selectedNode) {
      message.warning('请先选择要下载的文件')
      return
    }
    if (selectedNode.isDirectory) {
      message.warning('暂不支持下载文件夹，请选择文件')
      return
    }
    handleDownload(selectedNode.path, selectedNode.title)
  }

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return
    try {
      const remotePath = currentPath + '/' + newFileName.trim()
      await invoke('create_file', { connectionId, path: remotePath })
      message.success('文件创建成功')
      setNewFileVisible(false)
      setNewFileName('')
      refreshCurrent()
    } catch (err) {
      message.error(`创建失败: ${err}`)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const remotePath = currentPath + '/' + newFolderName.trim()
      await invoke('create_directory', { connectionId, path: remotePath })
      message.success('文件夹创建成功')
      setNewFolderVisible(false)
      setNewFolderName('')
      refreshCurrent()
    } catch (err) {
      message.error(`创建失败: ${err}`)
    }
  }

  const handleRename = async () => {
    if (!renameValue.trim() || !selectedNode) return
    try {
      const newPath = selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/')) + '/' + renameValue.trim()
      await invoke('rename_file', { connectionId, oldPath: selectedNode.path, newPath })
      message.success('重命名成功')
      setRenameVisible(false)
      setRenameValue('')
      refreshCurrent()
    } catch (err) {
      message.error(`重命名失败: ${err}`)
    }
  }

  const handleDelete = async () => {
    if (!selectedNode) return
    try {
      if (selectedNode.isDirectory) {
        await invoke('delete_directory', { connectionId, path: selectedNode.path })
      } else {
        await invoke('delete_file', { connectionId, path: selectedNode.path })
      }
      message.success('删除成功')
      setDeleteVisible(false)
      if (viewMode === 'list') {
        loadDirectory(currentPath, true)
      } else {
        const parentPath = selectedNode.path.substring(0, selectedNode.path.lastIndexOf('/')) || '/'
        refreshDirectoryRef.current?.(parentPath)
      }
    } catch (err) {
      message.error(`删除失败: ${err}`)
    }
  }

  const handleChmod = async () => {
    if (!selectedNode || !chmodValue.trim()) return
    try {
      await invoke('chmod_file', { connectionId, path: selectedNode.path, mode: parseInt(chmodValue.trim(), 8) })
      message.success('权限修改成功')
      setChmodVisible(false)
      refreshCurrent()
    } catch (err) {
      message.error(`修改权限失败: ${err}`)
    }
  }

  const handleCompress = async () => {
    if (!selectedNode || !compressName.trim()) return
    try {
      const outputPath = currentPath + '/' + compressName.trim()
      await invoke('compress_file', { connectionId, sourcePath: selectedNode.path, outputPath })
      message.success('压缩成功')
      setCompressVisible(false)
      setCompressName('')
      refreshCurrent()
    } catch (err) {
      message.error(`压缩失败: ${err}`)
    }
  }

  const copyFileName = async () => {
    if (selectedNode) {
      try {
        await navigator.clipboard.writeText(selectedNode.title)
        message.success('文件名已复制')
      } catch {
        message.error('复制失败')
      }
    }
    setContextMenuVisible(false)
  }

  const copyFullPath = async () => {
    if (selectedNode) {
      try {
        await navigator.clipboard.writeText(selectedNode.path)
        message.success('路径已复制')
      } catch {
        message.error('复制失败')
      }
    }
    setContextMenuVisible(false)
  }

  const contextMenuItems = [
    { key: 'refresh', label: '刷新', icon: <ReloadOutlined />, onClick: () => { refreshCurrent(); setContextMenuVisible(false) } },
    { key: 'newFile', label: '新建文件', icon: <FileAddOutlined />, onClick: () => { setNewFileVisible(true); setContextMenuVisible(false) } },
    { key: 'newFolder', label: '新建文件夹', icon: <FolderAddOutlined />, onClick: () => { setNewFolderVisible(true); setContextMenuVisible(false) } },
    { type: 'divider' as const },
    { key: 'rename', label: '重命名', icon: <EditOutlined />, onClick: () => { setRenameValue(selectedNode?.title || ''); setRenameVisible(true); setContextMenuVisible(false) } },
    { key: 'chmod', label: '修改权限', icon: <EyeOutlined />, onClick: () => { setChmodValue(selectedNode?.permissions || '644'); setChmodVisible(true); setContextMenuVisible(false) } },
    { type: 'divider' as const },
    { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => { if (selectedNode && !selectedNode.isDirectory) handleDownload(selectedNode.path, selectedNode.title); setContextMenuVisible(false) } },
    { key: 'upload', label: '上传文件', icon: <UploadOutlined />, onClick: () => { handleUploadFile(); setContextMenuVisible(false) } },
    { key: 'uploadFolder', label: '上传文件夹', icon: <FolderAddOutlined />, onClick: () => { handleUploadFolder(); setContextMenuVisible(false) } },
    { type: 'divider' as const },
    { key: 'copyName', label: '复制文件名', icon: <CopyOutlined />, onClick: copyFileName },
    { key: 'copyPath', label: '复制绝对路径', icon: <ScissorOutlined />, onClick: copyFullPath },
    { type: 'divider' as const },
    { key: 'compress', label: '压缩', icon: <CompressOutlined />, onClick: () => { setCompressName((selectedNode?.title || '') + '.tar.gz'); setCompressVisible(true); setContextMenuVisible(false) } },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => { setDeleteVisible(true); setContextMenuVisible(false) } },
  ]

  if (!visible) return null

  return (
    <div
      ref={panelRef}
      className="file-manager-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 32,
        width: 360,
        background: isDragOver ? 'rgba(0, 185, 107, 0.05)' : '#252526',
        borderLeft: isDragOver ? '3px solid #00b96b' : '1px solid #3F3F46',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.3)',
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      {isDragOver && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          padding: '12px 16px',
          background: 'rgba(0, 185, 107, 0.15)',
          borderRadius: 6,
          border: '2px dashed #00b96b',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <CloudUploadOutlined style={{ color: '#00b96b', fontSize: 18, marginRight: 8 }} />
          <span style={{ color: '#00b96b', fontSize: 14, fontWeight: 500 }}>释放以上传文件到当前目录</span>
        </div>
      )}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#CCC', fontSize: 14, fontWeight: 500 }}>文件管理</span>
          <Tooltip title={viewMode === 'tree' ? '切换到列表视图' : '切换到树形视图'}>
            <Button
              size="small"
              icon={viewMode === 'tree' ? <UnorderedListOutlined /> : <PartitionOutlined />}
              onClick={() => {
                const newMode = viewMode === 'tree' ? 'list' : 'tree'
                setViewMode(newMode)
                localStorage.setItem('iterminal_file_view_mode', newMode)
              }}
              style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
            />
          </Tooltip>
        </div>
        <Button
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#999' }}
        />
      </div>

      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <Input
          size="small"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onPressEnter={onPathInputPressEnter}
          placeholder="输入路径..."
          style={{
            flex: 1,
            background: '#1E1E1E',
            border: '1px solid #3F3F46',
            color: '#CCC',
          }}
        />
      </div>

      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #3F3F46',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        <Tooltip title="Home目录">
          <Button
            size="small"
            icon={<HomeOutlined />}
            onClick={goHome}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="返回上级">
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
              store.setCurrentPath(connectionId, parent)
              loadDirectory(parent, true)
            }}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="刷新当前文件夹">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={refreshCurrent}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}>
          <Button
            size="small"
            icon={showHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            onClick={() => setShowHidden(!showHidden)}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="上传文件">
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={handleUploadFile}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="上传文件夹">
          <Button
            size="small"
            icon={<CloudUploadOutlined />}
            onClick={handleUploadFolder}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="下载选中文件">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleDownloadSelected}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
        <Tooltip title="新建文件夹">
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => setNewFolderVisible(true)}
            style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
          />
        </Tooltip>
      </div>

      <div
        ref={treeContainerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 8,
          background: '#252526',
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : treeData.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#666' }}>空目录</span>}
          />
        ) : viewMode === 'tree' ? (
          <DirectoryTree
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            onSelect={onSelect}
            onExpand={onExpand}
            loadData={onLoadData}
            expandAction="doubleClick"
            titleRender={renderTreeNode}
            onRightClick={onTreeRightClick}
            onMouseEnter={({ event }) => {
              const target = event.target as HTMLElement
              const wrapper = target.closest('.ant-tree-node-content-wrapper')
              if (wrapper) {
                wrapper.removeAttribute('title')
              }
            }}
          />
        ) : (
          <>
            <div style={{ 
              display: 'flex', 
              gap: 8, 
              padding: '4px 8px', 
              borderBottom: '1px solid #3F3F46',
              marginBottom: 4,
            }}>
              <span
                onClick={() => {
                  if (sortField !== 'name') {
                    setSortField('name')
                    setSortOrder('asc')
                  } else if (sortOrder === 'asc') {
                    setSortOrder('desc')
                  } else {
                    setSortField(null)
                  }
                }}
                style={{ 
                  color: sortField === 'name' ? '#00b96b' : '#666', 
                  fontSize: 11, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                名称 {sortField === 'name' && (sortOrder === 'asc' ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : <ArrowDownOutlined style={{ fontSize: 10 }} />)}
              </span>
              <span
                onClick={() => {
                  if (sortField !== 'size') {
                    setSortField('size')
                    setSortOrder('asc')
                  } else if (sortOrder === 'asc') {
                    setSortOrder('desc')
                  } else {
                    setSortField(null)
                  }
                }}
                style={{ 
                  color: sortField === 'size' ? '#00b96b' : '#666', 
                  fontSize: 11, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                大小 {sortField === 'size' && (sortOrder === 'asc' ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : <ArrowDownOutlined style={{ fontSize: 10 }} />)}
              </span>
              <span
                onClick={() => {
                  if (sortField !== 'modified') {
                    setSortField('modified')
                    setSortOrder('asc')
                  } else if (sortOrder === 'asc') {
                    setSortOrder('desc')
                  } else {
                    setSortField(null)
                  }
                }}
                style={{ 
                  color: sortField === 'modified' ? '#00b96b' : '#666', 
                  fontSize: 11, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                修改时间 {sortField === 'modified' && (sortOrder === 'asc' ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : <ArrowDownOutlined style={{ fontSize: 10 }} />)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(sortField ? [...treeData].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1
                }
                let cmp = 0
                if (sortField === 'name') {
                  cmp = (a.title || '').localeCompare(b.title || '')
                } else if (sortField === 'size') {
                  cmp = (a.size || 0) - (b.size || 0)
                } else if (sortField === 'modified') {
                  cmp = (a.modified || '').localeCompare(b.modified || '')
                }
                return sortOrder === 'asc' ? cmp : -cmp
              }) : treeData).map((item) => (
                <div
                  key={item.key}
                  data-dir-path={item.isDirectory ? item.path : undefined}
                  className="file-list-item"
                  onClick={() => {
                    setSelectedKeys([item.key])
                    setSelectedNode(item)
                  }}
                  onDoubleClick={() => {
                    if (item.isDirectory) {
                      store.setCurrentPath(connectionId, item.path)
                      loadDirectory(item.path, true)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelectedNode(item)
                    setSelectedKeys([item.key])
                    setContextMenuPos({ x: e.clientX, y: e.clientY })
                    setContextMenuVisible(true)
                  }}
                  style={{
                    padding: '8px 12px',
                    background: selectedKeys.includes(item.key) ? 'rgba(0, 185, 107, 0.15)' : (dragTargetPath === item.path ? 'rgba(0, 185, 107, 0.25)' : 'transparent'),
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    border: dragTargetPath === item.path ? '2px dashed #00b96b' : '2px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedKeys.includes(item.key) && dragTargetPath !== item.path) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedKeys.includes(item.key) && dragTargetPath !== item.path) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <div style={{ 
                    fontSize: 13,
                    marginBottom: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    {item.isDirectory ? <FolderOutlined /> : <FileOutlined />}
                    <span style={{ 
                      color: item.isDirectory ? '#00b96b' : '#CCC',
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      whiteSpace: 'nowrap' 
                    }}>{item.title}</span>
                  </div>
                  <div style={{ 
                    color: '#666', 
                    fontSize: 11,
                    display: 'flex',
                    gap: 12,
                  }}>
                    <span>{formatSize(item.size || 0)}</span>
                    <span>{item.modified || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {contextMenuVisible && createPortal(
        <div
          style={{
            position: 'fixed',
            left: contextMenuPos.x,
            top: Math.min(contextMenuPos.y, window.innerHeight - 400),
            zIndex: 9999,
            background: '#2D2D30',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            minWidth: 160,
            maxHeight: `calc(100vh - ${Math.min(contextMenuPos.y, window.innerHeight - 400) + 20}px)`,
            overflowY: 'auto',
          }}
          onClick={() => setContextMenuVisible(false)}
        >
          {contextMenuItems.map((item, index) => (
            item.type === 'divider' ? (
              <div key={`divider-${index}`} style={{ height: 1, background: '#3F3F46', margin: '4px 0' }} />
            ) : (
              <div
                key={item.key}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  color: item.danger ? '#ff4d4f' : '#CCC',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                }}
                onClick={item.onClick}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {item.icon}
                {item.label}
              </div>
            )
          ))}
        </div>,
        document.body
      )}

      <Modal
        title="新建文件"
        open={newFileVisible}
        onOk={handleCreateFile}
        onCancel={() => { setNewFileVisible(false); setNewFileName('') }}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ style: { background: '#00b96b' } }}
      >
        <Input
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          placeholder="输入文件名"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title="新建文件夹"
        open={newFolderVisible}
        onOk={handleCreateFolder}
        onCancel={() => { setNewFolderVisible(false); setNewFolderName('') }}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ style: { background: '#00b96b' } }}
      >
        <Input
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder="输入文件夹名"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title="重命名"
        open={renameVisible}
        onOk={handleRename}
        onCancel={() => { setRenameVisible(false); setRenameValue('') }}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ style: { background: '#00b96b' } }}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="输入新名称"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title="确认删除"
        open={deleteVisible}
        onOk={handleDelete}
        onCancel={() => setDeleteVisible(false)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>确定要删除 {selectedNode?.title} 吗？</p>
        <p style={{ color: '#ff4d4f' }}>此操作不可撤销</p>
      </Modal>

      <Modal
        title="修改权限"
        open={chmodVisible}
        onOk={handleChmod}
        onCancel={() => { setChmodVisible(false); setChmodValue('644') }}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ style: { background: '#00b96b' } }}
      >
        <Input
          value={chmodValue}
          onChange={(e) => setChmodValue(e.target.value)}
          placeholder="如: 644, 755"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title="压缩文件"
        open={compressVisible}
        onOk={handleCompress}
        onCancel={() => { setCompressVisible(false); setCompressName('') }}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ style: { background: '#00b96b' } }}
      >
        <p>将 {selectedNode?.title} 压缩为：</p>
        <Input
          value={compressName}
          onChange={(e) => setCompressName(e.target.value)}
          placeholder="输出文件名"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <Modal
        title="文件冲突"
        open={conflictModalVisible}
        onCancel={() => resolveConflictDialog('skip')}
        footer={null}
        width={420}
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{
            padding: '12px',
            background: 'rgba(255, 77, 79, 0.1)',
            borderRadius: 6,
            border: '1px solid rgba(255, 77, 79, 0.3)',
            marginBottom: 16
          }}>
            <p style={{ color: '#ff4d4f', margin: 0, fontSize: 13 }}>
              <ExclamationCircleOutlined style={{ marginRight: 6 }} />
              目标位置已存在同名文件
            </p>
          </div>
          <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>文件名</p>
          <p style={{ color: '#CCC', fontSize: 14, marginBottom: 16, wordBreak: 'break-all' }}>
            {conflictFile?.fileName}
          </p>
          <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>目标路径</p>
          <p style={{ color: '#CCC', fontSize: 14, marginBottom: 24, wordBreak: 'break-all' }}>
            {conflictFile?.remotePath}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button
              onClick={() => resolveConflictDialog('skip')}
              style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
            >
              跳过
            </Button>
            <Button
              onClick={() => resolveConflictDialog('rename')}
              style={{ background: 'transparent', border: '1px solid #3F3F46', color: '#999' }}
            >
              保留两者
            </Button>
            <Button
              danger
              onClick={() => resolveConflictDialog('overwrite')}
              style={{ background: '#ff4d4f', borderColor: '#ff4d4f' }}
            >
              覆盖
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}