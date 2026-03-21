import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { App } from 'antd'
import { TreeNode } from '../types'
import { getParentPath } from '../utils'

interface UseFileOperationsOptions {
  connectionId: string
  currentPath: string
  selectedNode: TreeNode | null
  selectedNodeRef: React.MutableRefObject<TreeNode | null>
  refreshCurrent: () => void
  loadDirectory: (path: string, isRoot: boolean) => void
  viewMode: 'tree' | 'list'
}

export function useFileOperations({
  connectionId,
  currentPath,
  selectedNode,
  selectedNodeRef,
  refreshCurrent,
  loadDirectory,
  viewMode,
}: UseFileOperationsOptions) {
  const { message } = App.useApp()

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

  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewContent, setPreviewContent] = useState('')
  const [previewFile, setPreviewFile] = useState<{ name: string; path: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewTruncated, setPreviewTruncated] = useState(false)
  const [previewSize, setPreviewSize] = useState(0)

  const [editVisible, setEditVisible] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editFile, setEditFile] = useState<{ name: string; path: string } | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TreeNode[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const [extractVisible, setExtractVisible] = useState(false)
  const [extractLoading, setExtractLoading] = useState(false)

  const handleCreateFile = useCallback(async () => {
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
  }, [connectionId, currentPath, message, newFileName, refreshCurrent])

  const handleCreateFolder = useCallback(async () => {
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
  }, [connectionId, currentPath, message, newFolderName, refreshCurrent])

  const handleRename = useCallback(async () => {
    if (!renameValue.trim() || !selectedNode) return
    try {
      const newPath = getParentPath(selectedNode.path) + '/' + renameValue.trim()
      await invoke('rename_file', { connectionId, oldPath: selectedNode.path, newPath })
      message.success('重命名成功')
      setRenameVisible(false)
      setRenameValue('')
      refreshCurrent()
    } catch (err) {
      message.error(`重命名失败: ${err}`)
    }
  }, [connectionId, message, renameValue, refreshCurrent, selectedNode])

  const handleDelete = useCallback(async () => {
    const node = selectedNodeRef.current
    if (!node || !node.path) {
      message.error('未选择文件')
      return
    }
    try {
      if (node.isDirectory) {
        await invoke('delete_directory', { connectionId, path: node.path })
      } else {
        await invoke('delete_file', { connectionId, path: node.path })
      }
      message.success('删除成功')
      setDeleteVisible(false)
      if (viewMode === 'list') {
        loadDirectory(currentPath, true)
      } else {
        refreshCurrent()
      }
    } catch (err) {
      message.error(`删除失败: ${err}`)
    }
  }, [connectionId, currentPath, loadDirectory, message, refreshCurrent, selectedNodeRef, viewMode])

  const handleChmod = useCallback(async () => {
    if (!selectedNode || !chmodValue.trim()) return
    try {
      await invoke('chmod_file', {
        connectionId,
        path: selectedNode.path,
        mode: parseInt(chmodValue.trim(), 8),
      })
      message.success('权限修改成功')
      setChmodVisible(false)
      refreshCurrent()
    } catch (err) {
      message.error(`修改权限失败: ${err}`)
    }
  }, [chmodValue, connectionId, message, refreshCurrent, selectedNode])

  const handleCompress = useCallback(async () => {
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
  }, [compressName, connectionId, currentPath, message, refreshCurrent, selectedNode])

  const handlePreview = useCallback(async () => {
    if (!selectedNode || selectedNode.isDirectory) return
    setPreviewLoading(true)
    setPreviewFile({ name: selectedNode.title, path: selectedNode.path })
    try {
      const result = await invoke<{ content: string; size: number; truncated: boolean; encoding: string }>(
        'read_file_content',
        {
          connectionId,
          path: selectedNode.path,
          maxSize: 1024 * 1024,
        }
      )
      setPreviewContent(result.content)
      setPreviewSize(result.size)
      setPreviewTruncated(result.truncated)
      setPreviewVisible(true)
    } catch (err) {
      message.error(`预览失败: ${err}`)
    } finally {
      setPreviewLoading(false)
    }
  }, [connectionId, message, selectedNode])

  const handleEdit = useCallback(async () => {
    if (!selectedNode || selectedNode.isDirectory) return
    setEditLoading(true)
    setEditFile({ name: selectedNode.title, path: selectedNode.path })
    try {
      const result = await invoke<{ content: string; size: number; truncated: boolean; encoding: string }>(
        'read_file_content',
        {
          connectionId,
          path: selectedNode.path,
          maxSize: 10 * 1024 * 1024,
        }
      )
      if (result.truncated) {
        message.warning('文件较大，仅加载前 10MB 内容')
      }
      setEditContent(result.content)
      setEditVisible(true)
    } catch (err) {
      message.error(`读取文件失败: ${err}`)
    } finally {
      setEditLoading(false)
    }
  }, [connectionId, message, selectedNode])

  const handleSaveEdit = useCallback(async () => {
    if (!editFile) return
    setEditSaving(true)
    try {
      await invoke('write_file_content', {
        connectionId,
        path: editFile.path,
        content: editContent,
      })
      message.success('保存成功')
      setEditVisible(false)
    } catch (err) {
      message.error(`保存失败: ${err}`)
    } finally {
      setEditSaving(false)
    }
  }, [connectionId, editContent, editFile, message])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    const searchPath = currentPath || '/'
    console.log('[Search] Searching:', { connectionId, searchPath, pattern: searchQuery.trim() })
    try {
      const results = await invoke<
        { name: string; path: string; is_directory: boolean; size: number; modified: string }[]
      >('search_files', {
        connectionId,
        path: searchPath,
        pattern: searchQuery.trim(),
        maxResults: 100,
      })
      console.log('[Search] Results:', results)
      const nodes: TreeNode[] = results.map((r) => ({
        key: r.path,
        title: r.name,
        isDirectory: r.is_directory,
        path: r.path,
        size: r.size,
        modified: r.modified,
        isLeaf: !r.is_directory,
      }))
      setSearchResults(nodes)
      setSearchVisible(true)
    } catch (err) {
      console.error('[Search] Error:', err)
      message.error(`搜索失败: ${err}`)
    } finally {
      setSearchLoading(false)
    }
  }, [connectionId, currentPath, message, searchQuery])

  const handleExtract = useCallback(async () => {
    if (!selectedNode || selectedNode.isDirectory) return
    setExtractLoading(true)
    try {
      const parentPath = getParentPath(selectedNode.path)
      await invoke('extract_file', {
        connectionId,
        filePath: selectedNode.path,
        targetDir: parentPath,
      })
      message.success('解压成功')
      setExtractVisible(false)
      refreshCurrent()
    } catch (err) {
      message.error(`解压失败: ${err}`)
    } finally {
      setExtractLoading(false)
    }
  }, [connectionId, message, refreshCurrent, selectedNode])

  const copyFileName = useCallback(async () => {
    if (selectedNode) {
      try {
        await navigator.clipboard.writeText(selectedNode.title)
        message.success('文件名已复制')
      } catch {
        message.error('复制失败')
      }
    }
  }, [message, selectedNode])

  const copyFullPath = useCallback(async () => {
    if (selectedNode) {
      try {
        await navigator.clipboard.writeText(selectedNode.path)
        message.success('路径已复制')
      } catch {
        message.error('复制失败')
      }
    }
  }, [message, selectedNode])

  return {
    newFileVisible,
    setNewFileVisible,
    newFileName,
    setNewFileName,
    newFolderVisible,
    setNewFolderVisible,
    newFolderName,
    setNewFolderName,
    renameVisible,
    setRenameVisible,
    renameValue,
    setRenameValue,
    deleteVisible,
    setDeleteVisible,
    chmodVisible,
    setChmodVisible,
    chmodValue,
    setChmodValue,
    compressVisible,
    setCompressVisible,
    compressName,
    setCompressName,
    previewVisible,
    setPreviewVisible,
    previewContent,
    previewFile,
    previewLoading,
    previewTruncated,
    previewSize,
    editVisible,
    setEditVisible,
    editContent,
    setEditContent,
    editFile,
    editLoading,
    editSaving,
    searchVisible,
    setSearchVisible,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchLoading,
    extractVisible,
    setExtractVisible,
    extractLoading,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleDelete,
    handleChmod,
    handleCompress,
    handlePreview,
    handleEdit,
    handleSaveEdit,
    handleSearch,
    handleExtract,
    copyFileName,
    copyFullPath,
  }
}