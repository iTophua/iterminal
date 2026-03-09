import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs, Button, message, Space, Tooltip } from 'antd'
import { CloseOutlined, PlusOutlined, FullscreenOutlined, ScissorOutlined, SearchOutlined } from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { invoke } from '@tauri-apps/api/core'
import 'xterm/css/xterm.css'
import type { Connection } from './Connections'

interface TerminalTab {
  id: string
  title: string
  connectionId?: string
  shellId?: string
}

function Terminal() {
  const location = useLocation()
  const navigate = useNavigate()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminalInstances = useRef<{ [key: string]: XTerm }>({})
  const fitAddons = useRef<{ [key: string]: FitAddon }>({})
  const shellIds = useRef<{ [key: string]: string }>({})
  const readingRef = useRef<{ [key: string]: boolean }>({})
  const connectionProcessedRef = useRef<string | null>(null)

  // 处理连接 - 只在 location.state 改变时执行
  useEffect(() => {
    const state = location.state as { connectionId?: string; connection?: Connection } | null

    if (state?.connectionId && state.connectionId !== connectionProcessedRef.current) {
      connectionProcessedRef.current = state.connectionId
      const conn = state.connection!
      const connectionId = state.connectionId

      const connectAndGetShell = async () => {
        try {
          await invoke('connect_ssh', {
            id: connectionId,
            connection: {
              host: conn.host,
              port: conn.port,
              username: conn.username,
              password: conn.password || null,
              keyFile: null,
            }
          })

          const shellId = await invoke<string>('get_shell', { id: connectionId })

          const newId = Date.now().toString()

          const newTab: TerminalTab = {
            id: newId,
            title: `${conn.username}@${conn.host}`,
            connectionId,
            shellId,
          }

          // 直接设置 shellIds ref，确保初始化终端时能获取到
          shellIds.current[newId] = shellId
          setTabs([newTab])
          setActiveTab(newId)
        } catch (error) {
          message.error('Connection failed')
          console.error('Connection error:', error)
        }
      }
      connectAndGetShell()
    }
  }, [location.state])

  // 初始化终端 - 只在 activeTab 改变时执行
  useEffect(() => {
    if (!activeTab) {
      return
    }

    // 检查是否已经有终端实例
    if (terminalInstances.current[activeTab]) {
      return
    }

    const container = terminalRefs.current[activeTab]
    if (!container) {
      return
    }

    // 从 shellIds ref 获取 shellId
    const shellId = shellIds.current[activeTab]
    if (!shellId) {
      // shellId 还没设置，等待下次 render
      return
    }

    // 创建终端实例
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#FFFFFF',
        cursor: '#FFFFFF',
        cursorAccent: '#000000',
        selectionBackground: '#264F78',
      },
      convertEol: true,
      disableStdin: false,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // 清空容器
    container.innerHTML = ''

    // 打开终端
    terminal.open(container)
    
    // 设置输入处理 - 使用闭包捕获当前 activeTab，从 ref 获取 shellId
    terminal.onData((data) => {
      const currentShellId = shellIds.current[activeTab]
      if (currentShellId) {
        invoke('write_shell', { id: currentShellId, data }).catch((err) => {
          console.error('write_shell error:', err)
        })
      }
    })

    // 调整大小
    setTimeout(() => {
      try {
        fitAddon.fit()
      } catch (e) {}
    }, 100)
    
    // 存储 fitAddon 实例
    fitAddons.current[activeTab] = fitAddon
    
    // 存储终端实例
    terminalInstances.current[activeTab] = terminal

    // 启动读取循环 - 使用 ref 获取正确的 shellId
    if (!readingRef.current[activeTab]) {
      readingRef.current[activeTab] = true
      
      const readLoop = () => {
        if (!readingRef.current[activeTab]) {
          return
        }
        
        setTimeout(() => {
          if (!readingRef.current[activeTab]) {
            return
          }
          
          // 检查终端实例是否存在
          if (!terminalInstances.current[activeTab]) {
            readingRef.current[activeTab] = false
            return
          }
          
          // 从 ref 获取正确的 shellId
          const currentShellId = shellIds.current[activeTab]
          if (!currentShellId) {
            setTimeout(readLoop, 50)
            return
          }
          
          // 读取数据
          invoke<{ data: string; eof: boolean }>('read_shell', { id: currentShellId })
            .then(result => {
              if (!readingRef.current[activeTab] || !terminalInstances.current[activeTab]) {
                return
              }
              
              if (result && result.data) {
                terminalInstances.current[activeTab]?.write(result.data)
              }
            })
            .catch(() => {})
            .finally(() => {
              setTimeout(readLoop, 50)
            })
        }, 0)
      }
      
      readLoop()
    }

    // 自动调整大小
    const intervalId = setInterval(() => {
      try {
        fitAddon.fit()
      } catch (e) {}
    }, 5000)

    // 清理函数
    return () => {
      clearInterval(intervalId)
      readingRef.current[activeTab] = false
      if (terminalInstances.current[activeTab]) {
        terminalInstances.current[activeTab].dispose()
        delete terminalInstances.current[activeTab]
      }
      delete fitAddons.current[activeTab]
    }
  }, [activeTab])

  // 当 tabs 改变时，更新 shellIds ref
  useEffect(() => {
    tabs.forEach(tab => {
      if (tab.shellId && tab.id) {
        shellIds.current[tab.id] = tab.shellId
      }
    })
  }, [tabs])

  // 添加新会话
  const handleAddSession = useCallback(async () => {
    const existingTab = tabs.find(t => t.connectionId)
    if (!existingTab?.connectionId) {
      message.warning('No active connection to create new session')
      return
    }

    try {
      const shellId = await invoke<string>('get_shell', { id: existingTab.connectionId })
      const newId = Date.now().toString()

      const newTab: TerminalTab = {
        id: newId,
        title: `${existingTab.title.split(' ')[0]} (${tabs.length + 1})`,
        connectionId: existingTab.connectionId,
        shellId,
      }

      setTabs(prev => [...prev, newTab])
      setActiveTab(newId)
    } catch (error) {
      message.error(`Failed to create session: ${error}`)
    }
  }, [tabs])

  // 关闭 tab
  const handleCloseTab = useCallback(async (id: string) => {
    const tab = tabs.find(t => t.id === id)
    if (tab?.shellId) {
      readingRef.current[id] = false
      await invoke('close_shell', { id: tab.shellId }).catch(() => {})
    }

    if (terminalInstances.current[id]) {
      terminalInstances.current[id].dispose()
      delete terminalInstances.current[id]
    }

    if (tabs.length === 1 && tab?.connectionId) {
      await invoke('disconnect_ssh', { id: tab.connectionId }).catch(() => {})
      setTabs([])
      setActiveTab('')
      connectionProcessedRef.current = null
      return
    }

    const newTabs = tabs.filter(t => t.id !== id)
    setTabs(newTabs)
    if (activeTab === id) {
      setActiveTab(newTabs[0]?.id || '')
    }
  }, [tabs, activeTab])

  // 窗口大小调整
  useEffect(() => {
    const handleResize = () => {
      Object.keys(fitAddons.current).forEach(key => {
        try {
          fitAddons.current[key]?.fit()
        } catch (e) {}
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (tabs.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: '#1E1E1E', padding: 20
      }}>
        <p style={{ color: '#999999', marginBottom: 16, fontSize: 16 }}>No active sessions</p>
        <Button type="primary" onClick={() => navigate('/connections')}>Go to Connections</Button>
      </div>
    )
  }

  const tabItems = tabs.map(tab => ({
    key: tab.id,
    label: (
      <span style={{ color: '#CCCCCC' }}>
        {tab.title}
        {tabs.length > 1 && (
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id) }} />
        )}
      </span>
    ),
    children: (
      <div className="terminal-container" 
        ref={el => {
          terminalRefs.current[tab.id] = el
        }} 
        style={{
          width: '100%',
          height: '100%',
          background: '#000000'
        }}
      />
    ),
  }))

  return (
    <div className="terminal-page" style={{ height: '100%', display: 'flex', flexDirection: 'column', margin: 0, padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', background: '#252526', borderBottom: '1px solid #3F3F46',
        flexShrink: 0,
        height: 48
      }}>
        <Space size="small">
          <Button type="text" size="small" icon={<PlusOutlined />} onClick={handleAddSession} style={{ color: '#CCCCCC' }}>
            New Session
          </Button>
        </Space>
        <Space size="small">
          <Tooltip title="Copy"><Button type="text" size="small" icon={<ScissorOutlined />} style={{ color: '#999999' }} /></Tooltip>
          <Tooltip title="Search"><Button type="text" size="small" icon={<SearchOutlined />} style={{ color: '#999999' }} /></Tooltip>
          <Tooltip title="Fullscreen"><Button type="text" size="small" icon={<FullscreenOutlined />} style={{ color: '#999999' }} /></Tooltip>
        </Space>
      </div>

      <div className="terminal-content" style={{ flex: '1 1 0%', background: '#1E1E1E', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab} 
          items={tabItems} 
          type="editable-card" 
          hideAdd
          style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}
          tabBarStyle={{
            margin: 0,
            padding: '0 12px',
            height: 40,
            lineHeight: '40px',
            background: '#252526',
            borderBottom: '1px solid #3F3F46',
            flexShrink: 0
          }}
          onEdit={(targetKey, action) => { if (action === 'remove') handleCloseTab(targetKey as string) }} 
        />
      </div>
    </div>
  )
}

export default Terminal