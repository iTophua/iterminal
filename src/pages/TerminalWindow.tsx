import { useCallback, useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTerminalStore, type SplitPane } from '../stores/terminalStore'
import { getAllSessions } from '../utils/paneUtils'
import { ThemeProvider } from '../components/ThemeProvider'
import Terminal from './Terminal'

interface ConnectionData {
  connectionId: string
  connection: {
    id: string
    name: string
    host: string
    port: number
    username: string
    password?: string
    keyFile?: string
    group: string
    tags: string[]
    status: 'online' | 'offline' | 'connecting'
  }
  sessions: Array<{
    id: string
    title: string
  }>
  rootPane: SplitPane
}

function TerminalWindow() {
  const [initData, setInitData] = useState<ConnectionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isInitialized = useRef(false)
  const isClosing = useRef(false)
  const targetConnectionIdRef = useRef<string | null>(null)
  const acquiredShellIdsRef = useRef<string[]>([])

  const restoreConnection = useTerminalStore(s => s.restoreConnection)

  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true

    const init = async () => {
      let connectionId: string | null = null
      try {
        const hash = window.location.hash
        const labelMatch = hash.match(/[?&]label=([^&]+)/)
        const windowLabel = labelMatch ? labelMatch[1] : null
        
        if (!windowLabel) {
          setError('缺少窗口标识')
          return
        }

        const connectionDataStr = await invoke<string>('get_terminal_window_data', { windowLabel })
        const data: ConnectionData = JSON.parse(connectionDataStr)
        connectionId = data.connectionId
        targetConnectionIdRef.current = data.connectionId
        
        await invoke('connect_ssh', {
          id: data.connectionId,
          connection: {
            host: data.connection.host,
            port: data.connection.port,
            username: data.connection.username,
            password: data.connection.password,
            key_file: data.connection.keyFile,
          }
        })

        const sessions = getAllSessions(data.rootPane)
        
        for (const session of sessions) {
          session.connectionId = data.connectionId
          const newShellId = await invoke<string>('get_shell', { id: data.connectionId })
          session.shellId = newShellId
          acquiredShellIdsRef.current.push(newShellId)
        }
        
        restoreConnection(data.connection, data.rootPane)
        setInitData(data)
      } catch (err) {
        // 清理已获取的 shell
        for (const shellId of acquiredShellIdsRef.current) {
          await invoke('close_shell', { id: shellId }).catch(() => {})
        }
        if (connectionId) {
          await invoke('disconnect_ssh', { id: connectionId }).catch(() => {})
        }
        setError(String(err))
      }
    }

    init()
  }, [restoreConnection])

  // 关闭窗口前清理所有shell sessions，确保只清理本窗口的资源
  const cleanupWindowShells = useCallback(async () => {
    const targetId = targetConnectionIdRef.current
    if (!targetId) return

    // 优先使用 acquiredShellIdsRef 中记录的 shellId 列表来精确清理
    // 这包括 init 过程中获取的所有 shell，即使 initData 尚未设置
    for (const shellId of acquiredShellIdsRef.current) {
      await invoke('close_shell', { id: shellId }).catch(() => {})
    }

    // 最后调用 disconnect_ssh 确保连接级别的资源也被清理
    await invoke('disconnect_ssh', { id: targetId }).catch(() => {})
  }, [])

  // 使用 onCloseRequested 确保关闭前正确断开 SSH，避免与主窗口产生竞态
  useEffect(() => {
    const appWindow = getCurrentWindow()
    let unlisten: (() => void) | null = null

    appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      if (isClosing.current) return
      isClosing.current = true

      await cleanupWindowShells()
      await appWindow.destroy().catch(() => {})
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      if (unlisten) unlisten()
    }
  }, [cleanupWindowShells])

  if (error) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-container)',
        color: 'var(--color-text)',
        padding: 20,
      }}>
        <p style={{ color: 'var(--color-error)', marginBottom: 16 }}>初始化失败</p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{error}</p>
      </div>
    )
  }

  if (!initData) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-container)',
        color: 'var(--color-text)',
      }}>
        <p>正在加载...</p>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh' }}>
      <Terminal singleConnectionMode />
    </div>
  )
}

export default function TerminalWindowPage() {
  return (
    <ThemeProvider>
      <TerminalWindow />
    </ThemeProvider>
  )
}