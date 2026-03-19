import { useEffect, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
import { App } from 'antd'
import { TreeNode } from '../types'
import { getFileName } from '../utils'

interface UseDragDropOptions {
  visible: boolean
  connectionId: string
  currentPath: string
  selectedNode: TreeNode | null
  viewMode: 'tree' | 'list'
  uploadFile: (localPath: string, remotePath: string, fileName: string) => void
  uploadFolder: (localPath: string, remotePath: string, fileName: string) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  treeContainerRef: React.RefObject<HTMLDivElement | null>
}

export function useDragDrop({
  visible,
  connectionId,
  currentPath,
  selectedNode,
  viewMode,
  uploadFile,
  uploadFolder,
  panelRef,
  treeContainerRef,
}: UseDragDropOptions) {
  const { message } = App.useApp()
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetPath, setDragTargetPath] = useState<string | null>(null)
  const dragTargetPathRef = useRef<string | null>(null)

  useEffect(() => {
    dragTargetPathRef.current = dragTargetPath
  }, [dragTargetPath])

  useEffect(() => {
    if (!visible || !connectionId) return

    let unlisten: (() => void) | null = null

    const handleDrop = async (paths: string[]) => {
      const targetDir =
        dragTargetPathRef.current ||
        ((selectedNode?.isDirectory && selectedNode?.path) || currentPath)

      for (const localPath of paths) {
        try {
          const isDir = await invoke<boolean>('is_local_directory', { path: localPath })
          const fileName = getFileName(localPath)
          const remotePath = targetDir + '/' + fileName

          if (isDir) {
            uploadFolder(localPath, remotePath, fileName)
          } else {
            uploadFile(localPath, remotePath, fileName)
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
          return (
            x >= panelRect.left &&
            x <= panelRect.right &&
            y >= panelRect.top &&
            y <= panelRect.bottom
          )
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

          const allNodes =
            viewMode === 'list'
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
  }, [
    visible,
    connectionId,
    currentPath,
    selectedNode,
    message,
    viewMode,
    uploadFile,
    uploadFolder,
    panelRef,
    treeContainerRef,
  ])

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
  }, [isDragOver, dragTargetPath, treeContainerRef])

  return {
    isDragOver,
    dragTargetPath,
    setDragTargetPath,
    setIsDragOver,
    dragTargetPathRef,
  }
}