import { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfigProvider, theme as antdTheme, App } from 'antd'
import { useTerminalStore, type SplitPane, type Session } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { themes } from '../styles/themes/app-themes'
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

  const restoreConnection = useTerminalStore(s => s.restoreConnection)
  const connectedConnections = useTerminalStore(s => s.connectedConnections)

  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true

    const init = async () => {
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

        const sessions = getAllSessionsFromPane(data.rootPane)
        
        for (const session of sessions) {
          session.connectionId = data.connectionId
          const newShellId = await invoke<string>('get_shell', { id: data.connectionId })
          session.shellId = newShellId
        }
        
        restoreConnection(data.connection, data.rootPane)
        setInitData(data)
      } catch (err) {
        setError(String(err))
      }
    }

    init()
  }, [restoreConnection])

  useEffect(() => {
    return () => {
      if (connectedConnections.length > 0) {
        for (const conn of connectedConnections) {
          invoke('disconnect_ssh', { id: conn.connectionId }).catch(() => {})
        }
      }
    }
  }, [])

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

function getAllSessionsFromPane(pane: SplitPane): Session[] {
  const sessions: Session[] = []
  
  const traverse = (p: SplitPane) => {
    sessions.push(...p.sessions)
    if (p.children) {
      p.children.forEach(traverse)
    }
  }
  
  traverse(pane)
  return sessions
}

export default function TerminalWindowPage() {
  const appTheme = useThemeStore(s => s.appTheme)
  const selectedTheme = useThemeStore(s => s.selectedTheme)
  const currentThemeDef = themes[selectedTheme]

  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: currentThemeDef.antdPrimary,
          fontSize: 13,
        },
      }}
    >
      <App>
        <TerminalWindow />
      </App>
    </ConfigProvider>
  )
}