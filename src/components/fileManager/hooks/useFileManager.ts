import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { App } from 'antd'
import { useTerminalStore } from '../../../stores/terminalStore'
import { TreeNode } from '../types'
import { getParentPath } from '../utils'

interface UseFileManagerOptions {
  connectionId: string
  visible: boolean
  viewMode: 'tree' | 'list'
  showHidden: boolean
}

export function useFileManager({ connectionId, visible, viewMode, showHidden }: UseFileManagerOptions) {
  const { message } = App.useApp()
  const store = useTerminalStore()
  const connection = store.connectedConnections.find((c) => c.connectionId === connectionId)?.connection
  const currentPath = store.currentPaths[connectionId] || '/'
  const expandedKeys = store.expandedKeys[connectionId] || []

  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const treeDataRef = useRef<TreeNode[]>(treeData)
  const [loading, setLoading] = useState(false)
  const loadingPathsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    treeDataRef.current = treeData
  }, [treeData])

  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const selectedNodeRef = useRef<TreeNode | null>(null)

  useEffect(() => {
    selectedNodeRef.current = selectedNode
  }, [selectedNode])

  const [pathInput, setPathInput] = useState(currentPath)

  const mapFilesToNodes = useCallback(
    (files: any[]): TreeNode[] => {
      const filteredFiles = showHidden ? files : files.filter((f) => !f.name.startsWith('.'))
      return filteredFiles.map((file) => ({
        key: file.path,
        title: file.name,
        isDirectory: file.is_directory,
        path: file.path,
        size: file.size,
        modified: file.modified,
        permissions: file.permissions,
        isLeaf: !file.is_directory,
      }))
    },
    [showHidden]
  )

  const updateTreeData = useCallback(
    (list: TreeNode[], parentPath: string, children: TreeNode[]): TreeNode[] => {
      return list.map((node) => {
        if (node.path === parentPath) {
          return { ...node, children }
        }
        if (node.children) {
          return { ...node, children: updateTreeData(node.children, parentPath, children) }
        }
        return node
      })
    },
    []
  )

  const findNodeByPath = useCallback((nodes: TreeNode[], path: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children) {
        const found = findNodeByPath(node.children, path)
        if (found) return found
      }
    }
    return null
  }, [])

  const loadDirectory = useCallback(
    async (path: string, isRoot = false) => {
      if (!connectionId) return
      if (loadingPathsRef.current.has(path)) return
      loadingPathsRef.current.add(path)

      if (isRoot && viewMode === 'list') {
        setLoading(true)
      }
      try {
        const files: any[] = await invoke('list_directory', { connectionId, path })
        const nodes = mapFilesToNodes(files)
        if (viewMode === 'list') {
          setTreeData(nodes)
        } else {
          if (isRoot) {
            const rootNode: TreeNode = {
              key: path,
              title: path === '/' ? '/' : path.split('/').pop() || path,
              isDirectory: true,
              path: path,
              isLeaf: false,
              children: nodes,
            }
            setTreeData([rootNode])
            store.setExpandedKeys(connectionId, [path])
            setSelectedKeys([path])
          } else {
            setTreeData((prev) => updateTreeData(prev, path, nodes))
          }
        }
        if (isRoot) {
          store.setCurrentPath(connectionId, path)
        }
        loadingPathsRef.current.delete(path)
      } catch (err) {
        loadingPathsRef.current.delete(path)
        if (path !== '/' && isRoot) {
          message.warning(`目录 "${path}" 不存在，已切换到根目录`)
          store.setCurrentPath(connectionId, '/')
          loadDirectory('/', true)
          return
        }
        message.error(`加载目录失败: ${err}`)
      } finally {
        if (isRoot && viewMode === 'list') {
          setLoading(false)
        }
      }
    },
    [connectionId, mapFilesToNodes, message, store, updateTreeData, viewMode]
  )

  const loadDirectoryRef = useRef(loadDirectory)
  const currentPathRef = useRef(currentPath)

  useEffect(() => {
    loadDirectoryRef.current = loadDirectory
    currentPathRef.current = currentPath
  }, [loadDirectory, currentPath])

  useEffect(() => {
    if (visible && connectionId) {
      const timer = setTimeout(() => {
        const path = currentPathRef.current
        loadDirectoryRef.current(path, true)
        setPathInput(path)
        setSelectedKeys([path])
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [visible, connectionId])

  useEffect(() => {
    if (visible && connectionId) {
      setPathInput(store.currentPaths[connectionId] || '/')
    }
  }, [visible, connectionId, store.currentPaths])

  const refreshCurrent = useCallback(async () => {
    const targetPath =
      viewMode === 'list'
        ? currentPath
        : selectedNode
          ? selectedNode.isDirectory
            ? selectedNode.path
            : getParentPath(selectedNode.path)
          : currentPath
    try {
      const files: any[] = await invoke('list_directory', { connectionId, path: targetPath })
      const nodes = mapFilesToNodes(files)
      if (viewMode === 'list') {
        setTreeData(nodes)
      } else {
        setTreeData((prev) => updateTreeData(prev, targetPath, nodes))
      }
    } catch (err) {
      message.error(`刷新失败: ${err}`)
    }
  }, [connectionId, currentPath, mapFilesToNodes, message, updateTreeData, viewMode, selectedNode])

  const refreshDirectory = useCallback(
    async (dirPath: string) => {
      try {
        const files: any[] = await invoke('list_directory', { connectionId, path: dirPath })
        const nodes = mapFilesToNodes(files)
        if (viewMode === 'list') {
          if (dirPath === currentPath) {
            setTreeData(nodes)
          }
        } else {
          setTreeData((prev) => updateTreeData(prev, dirPath, nodes))
        }
      } catch (err) {
        message.error(`刷新失败: ${err}`)
      }
    },
    [connectionId, currentPath, mapFilesToNodes, message, updateTreeData, viewMode]
  )

  const goHome = useCallback(() => {
    const homePath = '/home/' + (connection?.username || '')
    store.setCurrentPath(connectionId, homePath)
    loadDirectory(homePath, true)
  }, [connection?.username, connectionId, loadDirectory, store])

  const onExpand = useCallback(
    (keys: React.Key[], info: any) => {
      store.setExpandedKeys(connectionId, keys as string[])
      if (info.expanded && info.node && !info.node.isLeaf) {
        const node = findNodeByPath(treeDataRef.current, info.node.key as string)
        if (node && !node.children) {
          loadDirectory(node.path, false)
        }
      }
    },
    [connectionId, findNodeByPath, loadDirectory, store]
  )

  const onSelect = useCallback(
    (keys: React.Key[]) => {
      setSelectedKeys(keys as string[])
      if (keys.length > 0) {
        const nodePath = keys[0] as string
        const node = findNodeByPath(treeDataRef.current, nodePath)
        if (node) {
          setSelectedNode(node)
        }
      }
    },
    [findNodeByPath]
  )

  const selectedNodes = selectedKeys
    .map(key => findNodeByPath(treeDataRef.current, key as string))
    .filter((n): n is TreeNode => n !== null)

  return {
    treeData,
    treeDataRef,
    loading,
    selectedKeys,
    setSelectedKeys,
    selectedNode,
    selectedNodeRef,
    selectedNodes,
    expandedKeys,
    currentPath,
    pathInput,
    setPathInput,
    connection,
    loadDirectory,
    refreshCurrent,
    refreshDirectory,
    goHome,
    onExpand,
    onSelect,
    findNodeByPath,
    mapFilesToNodes,
    updateTreeData,
  }
}