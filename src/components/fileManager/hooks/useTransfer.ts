import { useCallback, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { App } from 'antd'
import { useTransferStore } from '../../../stores/transferStore'
import { useTerminalStore } from '../../../stores/terminalStore'
import { TreeNode, ConflictFile } from '../types'
import { generateTaskId, getFileName, getParentPath } from '../utils'

const TRANSFER_TIMEOUT_MS = 30_000 // 30 秒无进度视为超时

interface UseTransferOptions {
  connectionId: string
  currentPath: string
  selectedNode: TreeNode | null
  refreshDirectory: (path: string) => void
}

export function useTransfer({
  connectionId,
  currentPath,
  selectedNode,
  refreshDirectory,
}: UseTransferOptions) {
  const { message } = App.useApp()
  const connection = useTerminalStore((s) =>
    s.connectedConnections.find((c) => c.connectionId === connectionId)?.connection
  )

  const checkFileConflict = useCallback(
    async (remotePath: string): Promise<boolean> => {
      try {
        return await invoke('file_exists', { connectionId, path: remotePath })
      } catch {
        return false
      }
    },
    [connectionId]
  )

  const generateUniqueFileName = useCallback(
    async (baseName: string, extension: string, targetDir: string): Promise<string> => {
      let counter = 1
      const maxAttempts = 100
      while (counter <= maxAttempts) {
        const newName = `${baseName}_${counter}${extension}`
        const remotePath = targetDir + '/' + newName
        const exists = await checkFileConflict(remotePath)
        if (!exists) return newName
        counter++
      }
      return `${baseName}_${Date.now()}${extension}`
    },
    [checkFileConflict]
  )

  const showConflictDialog = useCallback(
    (fileInfo: ConflictFile): Promise<'overwrite' | 'skip' | 'rename'> => {
      return new Promise((resolve) => {
        conflictResolvePromiseRef.current = { resolve, fileInfo }
        setConflictFile(fileInfo)
        setConflictModalVisible(true)
      })
    },
    []
  )

  const conflictResolvePromiseRef = useRef<{
    resolve: (action: 'overwrite' | 'skip' | 'rename') => void
    fileInfo?: ConflictFile
  } | null>(null)
  const [conflictModalVisible, setConflictModalVisible] = useState(false)
  const [conflictFile, setConflictFile] = useState<ConflictFile | null>(null)

  const resolveConflictDialog = useCallback((action: 'overwrite' | 'skip' | 'rename') => {
    setConflictModalVisible(false)
    if (conflictResolvePromiseRef.current) {
      conflictResolvePromiseRef.current.resolve(action)
      conflictResolvePromiseRef.current = null
    }
  }, [])

  /** 计算传输速度 (bytes/sec) */
  const calculateSpeed = useCallback((transferred: number, startTime: number): number => {
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed <= 0) return 0
    return transferred / elapsed
  }, [])

  /** 设置传输超时定时器 */
  const setupTransferTimeout = useCallback((
    taskId: string,
    unlistenProgress: () => void,
    unlistenComplete: () => void,
    failWithError: (err: string) => void
  ) => {
    let lastTransferred = 0
    let lastActivityTime = Date.now()

    const checkInterval = setInterval(() => {
      const progress = useTransferStore.getState().progress[taskId]
      if (progress) {
        if (progress.transferred !== lastTransferred) {
          lastTransferred = progress.transferred
          lastActivityTime = Date.now()
        } else if (Date.now() - lastActivityTime > TRANSFER_TIMEOUT_MS) {
          clearInterval(checkInterval)
          unlistenProgress()
          unlistenComplete()
          failWithError(`传输超时：${Math.round(TRANSFER_TIMEOUT_MS / 1000)} 秒无进度`)
        }
      }
    }, 1000)

    return checkInterval
  }, [])

  const performUpload = useCallback(
    async (localPath: string, remotePath: string, fileName: string, targetDir: string) => {
      const taskId = generateTaskId()
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
          const state = useTransferStore.getState()
          const record = state.records[taskId]
          const speed = record ? calculateSpeed(event.payload.transferred, record.startTime) : 0
          state.updateProgress(
            taskId,
            event.payload.transferred,
            event.payload.total,
            event.payload.totalFiles,
            event.payload.completedFiles,
            speed
          )
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
              refreshDirectory(targetDir)
            } else {
              useTransferStore.getState().updateRecord(taskId, {
                status: 'failed',
                error: result.error || 'Unknown error',
              })
              message.error(`上传失败: ${result.error}`)
            }
          }
        ).then((unlistenComplete) => {
          const failWithError = (err: string) => {
            useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: err })
            message.error(`上传失败: ${err}`)
          }

          const timeoutInterval = setupTransferTimeout(taskId, unlistenProgress, unlistenComplete, failWithError)

          invoke('upload_file', { taskId, connectionId, localPath, remotePath }).catch((err) => {
            clearInterval(timeoutInterval)
            unlistenProgress()
            unlistenComplete()
            useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
            message.error(`上传失败: ${err}`)
          }).finally(() => {
            clearInterval(timeoutInterval)
          })
        })
      })
    },
    [connectionId, connection, message, refreshDirectory, calculateSpeed, setupTransferTimeout]
  )

  const uploadFile = useCallback(
    async (localPath: string, remotePath: string, fileName: string, targetDir?: string) => {
      const dir = targetDir || getParentPath(remotePath)
      const exists = await checkFileConflict(remotePath)

      if (exists) {
        const action = await showConflictDialog({
          localPath,
          remotePath,
          fileName,
          targetDir: dir,
        })

        if (action === 'skip') return
        if (action === 'rename') {
          const lastDotIndex = fileName.lastIndexOf('.')
          const baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName
          const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : ''
          const newFileName = await generateUniqueFileName(baseName, extension, dir)
          const newRemotePath = dir + '/' + newFileName
          performUpload(localPath, newRemotePath, newFileName, dir)
          return
        }
      }

      performUpload(localPath, remotePath, fileName, dir)
    },
    [checkFileConflict, showConflictDialog, generateUniqueFileName, performUpload]
  )

  const uploadFolder = useCallback(
    async (localPath: string, remotePath: string, folderName: string, targetDir?: string) => {
      const taskId = generateTaskId()
      const now = Date.now()
      const conn = connection
      const dir = targetDir || getParentPath(remotePath)

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
          useTransferStore
            .getState()
            .updateProgress(
              taskId,
              event.payload.transferred,
              event.payload.total,
              event.payload.totalFiles,
              event.payload.completedFiles
            )
        }
      ).then((unlisten) => {
        invoke<{ success: boolean; cancelled: boolean }>('upload_folder', {
          taskId,
          connectionId,
          localPath,
          remotePath,
        })
          .then((result) => {
            if (result.cancelled) {
              useTransferStore.getState().updateRecord(taskId, { status: 'cancelled', endTime: Date.now() })
            } else {
              useTransferStore.getState().updateRecord(taskId, { status: 'completed', endTime: Date.now() })
              message.success(`上传完成: ${folderName}`)
              refreshDirectory(dir)
            }
          })
          .catch((err) => {
            useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
            message.error(`上传失败: ${err}`)
          })
          .finally(() => unlisten())
      })
    },
    [connectionId, connection, message, refreshDirectory]
  )

  const handleUploadFile = useCallback(async () => {
    try {
      const selected = await open({ multiple: true, title: '选择要上传的文件' })
      if (selected && Array.isArray(selected) && selected.length > 0) {
        const targetDir = (selectedNode?.isDirectory && selectedNode?.path) || currentPath
        for (const filePath of selected) {
          const fileName = getFileName(filePath)
          const remotePath = targetDir + '/' + fileName
          await uploadFile(filePath, remotePath, fileName)
        }
      }
    } catch (err) {
      console.error('上传失败:', err)
    }
  }, [selectedNode, currentPath, uploadFile])

  const handleUploadFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: '选择要上传的文件夹' })
      if (selected) {
        const targetDir = (selectedNode?.isDirectory && selectedNode?.path) || currentPath
        const folderName = getFileName(selected)
        let remotePath = targetDir + '/' + folderName

        const exists = await checkFileConflict(remotePath)
        if (exists) {
          const action = await showConflictDialog({
            localPath: selected,
            remotePath,
            fileName: folderName,
            targetDir,
          })

          if (action === 'skip') return
          if (action === 'rename') {
            const newFolderName = await generateUniqueFileName(folderName, '', targetDir)
            remotePath = targetDir + '/' + newFolderName
            await uploadFolder(selected, remotePath, newFolderName)
            return
          }
        }

        await uploadFolder(selected, remotePath, folderName)
      }
    } catch (err) {
      console.error('上传文件夹失败:', err)
    }
  }, [
    selectedNode,
    currentPath,
    checkFileConflict,
    showConflictDialog,
    generateUniqueFileName,
    uploadFolder,
  ])

  const handleDownload = useCallback(
    async (remotePath: string, fileName: string) => {
      try {
        const savePath = await save({ defaultPath: fileName, title: '保存文件' })
        if (savePath) {
          const taskId = generateTaskId()
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
              const state = useTransferStore.getState()
              const record = state.records[taskId]
              const speed = record ? calculateSpeed(event.payload.transferred, record.startTime) : 0
              state.updateProgress(taskId, event.payload.transferred, event.payload.total, undefined, undefined, speed)
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
                  useTransferStore.getState().updateRecord(taskId, {
                    status: 'failed',
                    error: result.error || 'Unknown error',
                  })
                  message.error(`下载失败: ${result.error}`)
                }
              }
            ).then((unlistenComplete) => {
              const failWithError = (err: string) => {
                useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: err })
                message.error(`下载失败: ${err}`)
              }

              const timeoutInterval = setupTransferTimeout(taskId, unlistenProgress, unlistenComplete, failWithError)

              invoke('download_file', {
                taskId,
                connectionId,
                remotePath,
                localPath: savePath,
              }).catch((err) => {
                clearInterval(timeoutInterval)
                unlistenProgress()
                unlistenComplete()
                useTransferStore.getState().updateRecord(taskId, { status: 'failed', error: String(err) })
                message.error(`下载失败: ${err}`)
              }).finally(() => {
                clearInterval(timeoutInterval)
              })
            })
          })
        }
      } catch (err) {
        console.error('保存对话框取消:', err)
      }
    },
    [connectionId, connection, message, calculateSpeed, setupTransferTimeout]
  )

  const handleDownloadSelected = useCallback(() => {
    if (!selectedNode) {
      message.warning('请先选择要下载的文件')
      return
    }
    if (selectedNode.isDirectory) {
      message.warning('暂不支持下载文件夹，请选择文件')
      return
    }
    handleDownload(selectedNode.path, selectedNode.title)
  }, [selectedNode, handleDownload, message])

  return {
    handleUploadFile,
    handleUploadFolder,
    handleDownload,
    handleDownloadSelected,
    uploadFile,
    uploadFolder,
    conflictModalVisible,
    conflictFile,
    resolveConflictDialog,
  }
}