import { useEffect, useRef, useCallback, useState } from 'react'
import { Tabs, Tooltip, Input, Button, App } from 'antd'
import { CloseOutlined, PlusOutlined, FullscreenOutlined, ScissorOutlined, SearchOutlined, ToolOutlined, LeftOutlined, RightOutlined, CopyOutlined, SnippetsOutlined, CheckCircleOutlined, DashboardOutlined, FolderOutlined, PushpinOutlined, ApiOutlined } from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '../stores/terminalStore'
import { useThemeStore, TerminalThemeKey } from '../stores/themeStore'
import MonitorPanel from '../components/MonitorPanel'
import FileManagerPanel from '../components/FileManagerPanel'
import McpLogPanel from '../components/McpLogPanel'
import { terminalThemes, TerminalTheme } from '../styles/themes/terminal-themes'

function getTerminalTheme(key: TerminalThemeKey): TerminalTheme['theme'] {
  const themeMap: Record<TerminalThemeKey, TerminalTheme> = {
    'classic': terminalThemes[0],
    'solarized-dark': terminalThemes[1],
    'solarized-light': terminalThemes[2],
    'dracula': terminalThemes[3],
    'one-dark': terminalThemes[4],
  }
  return themeMap[key]?.theme ?? terminalThemes[0].theme
}

function Terminal() {
  const { message } = App.useApp()
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const activeConnectionId = useTerminalStore(state => state.activeConnectionId)
  const setActiveConnection = useTerminalStore(state => state.setActiveConnection)
  const setActiveSession = useTerminalStore(state => state.setActiveSession)
  const addSession = useTerminalStore(state => state.addSession)
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)
  const setSidebarCollapsed = useTerminalStore(state => state.setSidebarCollapsed)
  const fileManagerVisible = useTerminalStore(state => state.fileManagerVisible)
  const setFileManagerVisible = useTerminalStore(state => state.setFileManagerVisible)
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  const terminalThemeKey = useThemeStore(state => state.terminalTheme)

  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminalInstances = useRef<{ [key: string]: XTerm }>({})
  const fitAddons = useRef<{ [key: string]: FitAddon }>({})
  const initializedRef = useRef<Set<string>>(new Set())
  const unlistenersRef = useRef<{ [key: string]: UnlistenFn }>({})
  const resizeObserversRef = useRef<{ [key: string]: ResizeObserver }>({})
  
  // 工具栏显示状态：'full' = 完整工具栏, 'ball' = 小球形态
  const [toolbarState, setToolbarState] = useState<'full' | 'ball'>('ball')
  // 工具栏自动隐藏设置
  const [autoHideToolbar, setAutoHideToolbar] = useState(() => {
    const saved = localStorage.getItem('iterminal_auto_hide_toolbar')
    return saved ? saved === 'true' : true
  })
  const [mouseOverBall, setMouseOverBall] = useState(false)
  
  // 搜索状态
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const searchAddons = useRef<{ [key: string]: SearchAddon }>({})
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean; sessionKey: string }>({ x: 0, y: 0, visible: false, sessionKey: '' })
  
  // 监控面板状态
  const [monitorVisible, setMonitorVisible] = useState(false)
  
  const [apiLogVisible, setApiLogVisible] = useState(false)
  
  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem('iterminal_mcp_enabled')
    return saved ? saved === 'true' : true
  })
  
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'iterminal_mcp_enabled') {
        setMcpEnabled(e.newValue === 'true')
      }
    }
    window.addEventListener('storage', handleStorageChange)
    
    const checkInterval = setInterval(() => {
      const saved = localStorage.getItem('iterminal_mcp_enabled')
      const enabled = saved ? saved === 'true' : true
      setMcpEnabled(prev => prev !== enabled ? enabled : prev)
    }, 1000)
    
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(checkInterval)
    }
  }, [])
  
  useEffect(() => {
    const newTheme = getTerminalTheme(terminalThemeKey)
    console.log('[Terminal] Theme changed to:', terminalThemeKey, newTheme)
    const instances = Object.values(terminalInstances.current)
    for (let i = 0; i < instances.length; i++) {
      const term = instances[i]
      if (term) {
        term.options.theme = newTheme
        term.refresh(0, term.rows - 1)
      }
    }
  }, [terminalThemeKey])
  
  // 全屏状态
  const [isFullscreen, setIsFullscreen] = useState(false)
  const activeConnection = connectedConnections.find(c => c.connectionId === activeConnectionId)
  const activeSession = activeConnection?.sessions.find(s => s.id === activeConnection?.activeSessionId)

  // 初始化终端
  useEffect(() => {
    if (!activeSession?.shellId) return

    const key = `${activeSession.connectionId}_${activeSession.id}`
    const shellId = activeSession.shellId
    
    // 已初始化过，调整大小并获取焦点
    if (initializedRef.current.has(key)) {
      const addon = fitAddons.current[key]
      const term = terminalInstances.current[key]
      if (addon) setTimeout(() => { try { addon.fit() } catch {} }, 50)
      if (term) setTimeout(() => { try { term.focus() } catch {} }, 50)
      return
    }

    const container = terminalRefs.current[key]
    if (!container) return

    let cancelled = false

    // 使用 async 函数确保正确的初始化顺序
    const init = async () => {
      // 1. 等待容器有有效尺寸
      const waitForContainerSize = (): Promise<void> => {
        return new Promise((resolve) => {
          const checkSize = () => {
            const rect = container.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              resolve()
            } else {
              requestAnimationFrame(checkSize)
            }
          }
          checkSize()
        })
      }
      
      await waitForContainerSize()
      
      // 2. 创建终端
      const terminal = new XTerm({
        cursorBlink: true,
        fontSize: terminalSettings.fontSize,
        fontFamily: `${terminalSettings.fontFamily}, Menlo, Monaco, "Courier New", monospace`,
        theme: getTerminalTheme(terminalThemeKey),
        convertEol: true,
        disableStdin: false,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      container.innerHTML = ''
      terminal.open(container)
      
      // 输入处理
      terminal.onData(data => {
        invoke('write_shell', { id: shellId, data }).catch(console.error)
      })
      
      // 终端尺寸变化时通知 SSH 服务器
      terminal.onResize(({ cols, rows }) => {
        invoke('resize_shell', { id: shellId, cols, rows }).catch(console.error)
      })

      // 暂存到 ref，供事件回调使用
      terminalInstances.current[key] = terminal
      fitAddons.current[key] = fitAddon
      
      // 加载搜索插件
      const searchAddon = new SearchAddon()
      terminal.loadAddon(searchAddon)
      searchAddons.current[key] = searchAddon
      // 3. 注册事件监听
      const eventName = `shell-output-${shellId}`
      
      const unlisten = await listen<string>(eventName, (event) => {
        const term = terminalInstances.current[key]
        if (term && event.payload) {
          // 处理 EOF 信号（后端发送 { eof: true }）
          if (typeof event.payload === 'object' && (event.payload as any).eof) {
            return
          }
          term.write(event.payload)
        }
      })
      
      if (cancelled) {
        unlisten()
        return
      }
      
      unlistenersRef.current[key] = unlisten
      
      // 4. 设置 ResizeObserver 监听容器尺寸变化
      const resizeObserver = new ResizeObserver(() => {
        const addon = fitAddons.current[key]
        if (addon) { try { addon.fit() } catch {} }
      })
      resizeObserver.observe(container)
      resizeObserversRef.current[key] = resizeObserver
      
      // 5. 初始调整终端大小（延迟确保 xterm 完成渲染）
      setTimeout(() => {
        try { fitAddon.fit() } catch {}
      }, 100)
      
      // 标记为已初始化
      initializedRef.current.add(key)
      
      // 6. 通知后端开始发送数据
      await invoke('start_shell_reader', { id: shellId })
    }

    init().catch(console.error)

    return () => {
      cancelled = true
      // 清理 ResizeObserver
      if (resizeObserversRef.current[key]) {
        resizeObserversRef.current[key].disconnect()
        delete resizeObserversRef.current[key]
      }
      // 不取消事件监听器 - 保持活跃状态
    }
  }, [activeSession?.id, activeSession?.connectionId, activeSession?.shellId])


  // 新建会话
  const handleAddSession = useCallback(async (connectionId: string) => {
    if (!connectionId) return
    try {
      const shellId = await invoke<string>('get_shell', { id: connectionId })
      addSession(connectionId, shellId)
      message.success('会话已创建')
    } catch (err) {
      message.error(`创建失败: ${err}`)
    }
  }, [addSession])

  // 关闭会话
  const handleCloseSession = useCallback(async (connId: string, sessId: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    const sess = conn?.sessions.find(s => s.id === sessId)
    const key = `${connId}_${sessId}`

    // 清理事件监听
    if (unlistenersRef.current[key]) {
      unlistenersRef.current[key]()
      delete unlistenersRef.current[key]
    }

    if (sess?.shellId) {
      await invoke('close_shell', { id: sess.shellId }).catch(() => {})
    }
    
    if (terminalInstances.current[key]) {
      terminalInstances.current[key].dispose()
      delete terminalInstances.current[key]
    }
    delete fitAddons.current[key]
    delete searchAddons.current[key]
    delete resizeObserversRef.current[key]
    initializedRef.current.delete(key)
    if (conn && conn.sessions.length === 1) {
      await invoke('disconnect_ssh', { id: connId }).catch(() => {})
      closeConnection(connId)
    } else {
      closeSession(connId, sessId)
    }
  }, [connectedConnections, closeSession, closeConnection])

  // 关闭连接
  const handleCloseConnection = useCallback(async (connId: string) => {
    const conn = connectedConnections.find(c => c.connectionId === connId)
    if (!conn) return

    for (const s of conn.sessions) {
      const key = `${connId}_${s.id}`
      
      // 清理事件监听
      if (unlistenersRef.current[key]) {
        unlistenersRef.current[key]()
        delete unlistenersRef.current[key]
      }
      
      if (s.shellId) await invoke('close_shell', { id: s.shellId }).catch(() => {})
      if (terminalInstances.current[key]) {
        terminalInstances.current[key].dispose()
        delete terminalInstances.current[key]
      }
      delete fitAddons.current[key]
      delete searchAddons.current[key]
      delete resizeObserversRef.current[key]
      initializedRef.current.delete(key)
    }

    await invoke('disconnect_ssh', { id: connId }).catch(() => {})
    closeConnection(connId)
  }, [connectedConnections, closeConnection])

  // 窗口调整
  useEffect(() => {
    const resize = () => Object.values(fitAddons.current).forEach(a => { try { a?.fit() } catch {} })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // 清理所有事件监听
  useEffect(() => {
    return () => {
      Object.values(unlistenersRef.current).forEach(unlisten => unlisten())
    }
  }, [])
  
  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }))
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // 自动隐藏设置持久化
  useEffect(() => {
    localStorage.setItem('iterminal_auto_hide_toolbar', String(autoHideToolbar))
  }, [autoHideToolbar])
  
  // 终端设置变更时应用到所有已打开终端
  useEffect(() => {
    Object.values(terminalInstances.current).forEach(term => {
      if (term) {
        term.options.fontFamily = `"${terminalSettings.fontFamily}", Menlo, Monaco, monospace`
        term.options.fontSize = terminalSettings.fontSize
      }
    })
    Object.values(fitAddons.current).forEach(addon => {
      try { addon?.fit() } catch {}
    })
  }, [terminalSettings])
  
  // 处理全屏切换
  const handleToggleFullscreen = useCallback(async (sessionKey: string) => {
    try {
      const appWindow = getCurrentWindow()
      const isMax = await appWindow.isMaximized()
      
      if (isMax || isFullscreen) {
        // 退出全屏：取消最大化并恢复侧边栏
        if (isMax) {
          await appWindow.unmaximize()
        }
        setSidebarCollapsed(false)
        setIsFullscreen(false)
      } else {
        // 进入全屏：最大化窗口并收起侧边栏
        await appWindow.maximize()
        setSidebarCollapsed(true)
        setIsFullscreen(true)
      }
      
      // 调整终端大小
      setTimeout(() => {
        fitAddons.current[sessionKey]?.fit()
      }, 100)
    } catch (err) {
      console.error('全屏切换失败:', err)
    }
  }, [isFullscreen, setSidebarCollapsed])
  
  // 处理搜索
  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchText) return
    
    const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
    const activeSess = activeConn?.sessions.find(s => s.id === activeConn?.activeSessionId)
    if (!activeSess) return
    
    const key = `${activeSess.connectionId}_${activeSess.id}`
    const searchAddon = searchAddons.current[key]
    
    if (searchAddon) {
      if (direction === 'next') {
        searchAddon.findNext(searchText, { caseSensitive: false, wholeWord: false })
      } else {
        searchAddon.findPrevious(searchText, { caseSensitive: false, wholeWord: false })
      }
      // 更新搜索结果数量（xterm-addon-search 没有直接提供，这里简化处理）
    }
  }, [searchText, connectedConnections, activeConnectionId])
  
  // 处理右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, sessionKey: string) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      sessionKey
    })
  }, [])
  
  // 复制选中内容
  const handleCopy = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    if (term) {
      const selection = term.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
        message.success('已复制')
      } else {
        message.info('请先选择要复制的内容')
      }
    }
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu.sessionKey])
  
  // 粘贴
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        // 解析 sessionKey 获取正确的 shellId
        const [connId, sessId] = contextMenu.sessionKey.split('_')
        const conn = connectedConnections.find(c => c.connectionId === connId)
        const sess = conn?.sessions.find(s => s.id === sessId)
        if (sess?.shellId) {
          await invoke('write_shell', { id: sess.shellId, data: text })
        }
      }
    } catch (err) {
      console.error('粘贴失败:', err)
    }
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu.sessionKey, connectedConnections])
  
  // 全选
  const handleSelectAll = useCallback(() => {
    const term = terminalInstances.current[contextMenu.sessionKey]
    if (term) {
      term.selectAll()
    }
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [contextMenu.sessionKey])

  
  if (connectedConnections.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--color-bg-container)' }}>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>没有活动的会话</p>
        <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>请先在连接管理中连接服务器</p>
      </div>
    )
  }

  const connectionItems = connectedConnections.map(conn => {
    const sessionItems = conn.sessions.map((s, idx) => ({
      key: s.id,
      label: (
        <span style={{ color: 'var(--color-text)', fontSize: 12 }}>
          会话{idx + 1}
          <CloseOutlined style={{ marginLeft: 6, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseSession(conn.connectionId, s.id) }} />
        </span>
      ),
      children: (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* 悬浮工具栏 */}
          {toolbarState === 'full' && (!autoHideToolbar || mouseOverBall) ? (
            <div style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--color-bg-elevated)',
              borderRadius: 6,
              padding: '4px 8px',
              boxShadow: 'var(--shadow-md)',
            }}
            onMouseLeave={() => { if (autoHideToolbar) { setToolbarState('ball'); setMouseOverBall(false) } }}
            >
              <Tooltip title="复制选中内容">
                <span
                  style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                  onClick={() => {
                    const key = `${conn.connectionId}_${s.id}`
                    const term = terminalInstances.current[key]
                    if (term) {
                      const selection = term.getSelection()
                      if (selection) {
                        navigator.clipboard.writeText(selection)
                        message.success('已复制')
                      } else {
                        message.info('请先选择要复制的内容')
                      }
                    }
                  }}
                >
                  <ScissorOutlined />
                </span>
              </Tooltip>
              <Tooltip title="搜索">
                <span
                  style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                  onClick={() => setSearchVisible(!searchVisible)}
                >
                  <SearchOutlined />
                </span>
              </Tooltip>
              <Tooltip title={isFullscreen ? "退出全屏" : "全屏"}>
                <span
                  style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                  onClick={() => {
                    const key = `${conn.connectionId}_${s.id}`
                    handleToggleFullscreen(key)
                  }}
                >
                  <FullscreenOutlined />
                </span>
              </Tooltip>
              <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 4px' }} />
              <Tooltip title="系统监控">
                <span
                  style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px 6px', fontSize: 14 }}
                  onClick={() => {
                    setMonitorVisible(true)
                    if (activeConnectionId && fileManagerVisible[activeConnectionId]) {
                      setFileManagerVisible(activeConnectionId, false)
                    }
                  }}
                >
                  <DashboardOutlined />
                </span>
              </Tooltip>
              <Tooltip title="文件管理">
                <span
                  style={{
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    fontSize: 14
                  }}
                  onClick={() => {
                    const isVisible = fileManagerVisible[conn.connectionId]
                    setFileManagerVisible(conn.connectionId, !isVisible)
                    if (!isVisible) {
                      setMonitorVisible(false)
                    }
                  }}
                >
                  <FolderOutlined />
                </span>
              </Tooltip>
              {mcpEnabled && (
                <Tooltip title="MCP 日志">
                  <span
                    style={{
                      color: '#999',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      fontSize: 14
                    }}
                    onClick={() => setApiLogVisible(!apiLogVisible)}
                  >
                    <ApiOutlined />
                  </span>
                </Tooltip>
              )}
              
              <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 4px' }} />
              <Tooltip title={autoHideToolbar ? "固定工具栏" : "自动隐藏"}>
                <span
                  style={{ color: autoHideToolbar ? 'var(--color-text-quaternary)' : 'var(--color-primary)', cursor: 'pointer', padding: '4px 6px', fontSize: 12 }}
                  onClick={() => setAutoHideToolbar(!autoHideToolbar)}
                >
                  <PushpinOutlined />
                </span>
              </Tooltip>
            </div>
          ) : (
            <Tooltip title={autoHideToolbar ? "悬停展开工具栏" : "展开工具栏"}>
              <div
                onMouseEnter={() => {
                  setMouseOverBall(true)
                  setToolbarState('full')
                }}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 100,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--color-bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: autoHideToolbar ? 'default' : 'pointer',
                  boxShadow: 'var(--shadow-md)',
                }}
                onClick={() => {
                  if (!autoHideToolbar) setToolbarState('full')
                }}
              >
                <ToolOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />
              </div>
            </Tooltip>
          )}
          
          {/* 搜索栏 */}
          {searchVisible && toolbarState === 'full' && (
            <div style={{
              position: 'absolute',
              top: 44,
              right: 8,
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--color-bg-elevated)',
              borderRadius: 6,
              padding: '6px 8px',
              boxShadow: 'var(--shadow-md)',
            }}>
              <Input
                size="small"
                placeholder="搜索..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onPressEnter={() => handleSearch('next')}
                style={{ width: 150, background: 'var(--color-bg-container)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
              <Tooltip title="上一个">
                <Button size="small" icon={<LeftOutlined />} onClick={() => handleSearch('prev')} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
              </Tooltip>
              <Tooltip title="下一个">
                <Button size="small" icon={<RightOutlined />} onClick={() => handleSearch('next')} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
              </Tooltip>
              <Tooltip title="关闭">
                <Button size="small" icon={<CloseOutlined />} onClick={() => { setSearchVisible(false); setSearchText('') }} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }} />
              </Tooltip>
            </div>
          )}
          
          {/* 右键菜单 */}
          {contextMenu.visible && (
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 1000,
                background: 'var(--color-bg-elevated)',
                borderRadius: 6,
                boxShadow: 'var(--shadow-lg)',
                overflow: 'hidden',
                minWidth: 160,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleCopy}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <CopyOutlined /> 复制
              </div>
              <div
                style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handlePaste}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <SnippetsOutlined /> 粘贴
              </div>
              <div
                style={{ padding: '8px 16px', cursor: 'pointer', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={handleSelectAll}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <CheckCircleOutlined /> 全选
              </div>
              
            </div>
          )}
          
          <div 
            ref={el => { terminalRefs.current[`${conn.connectionId}_${s.id}`] = el }} 
            style={{ flex: 1, width: '100%', background: 'var(--color-bg-base)', overflow: 'hidden', paddingLeft: 8, boxSizing: 'border-box' }}
            onContextMenu={(e) => handleContextMenu(e, `${conn.connectionId}_${s.id}`)}
          />
        </div>
      ),
    }))

    return {
      key: conn.connectionId,
      label: (
        <span style={{ color: conn.connection.group === '生产环境' ? '#E65100' : 'var(--color-text)', fontWeight: 500 }}>
          {conn.connection.username}@{conn.connection.host}
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseConnection(conn.connectionId) }} />
        </span>
      ),
      children: (
        <Tabs
          activeKey={conn.activeSessionId || undefined}
          onChange={sid => { if (sid !== '__add__') setActiveSession(conn.connectionId, sid) }}
          items={[...sessionItems, { key: '__add__', label: <span style={{ color: 'var(--color-primary)', fontSize: 12 }}><PlusOutlined /> 新建</span>, children: <div /> }]}
          type="card"
          style={{ height: '100%' }}
          tabBarStyle={{ margin: 0, padding: '0 8px', background: 'var(--color-bg-container)', minHeight: 28 }}
          onTabClick={(key) => { if (key === '__add__') handleAddSession(conn.connectionId) }}
          destroyInactiveTabPane={false}
          size="small"
        />
      ),
    }
  })

  const getRightPanelWidth = () => {
    let width = 0
    if (monitorVisible) width += 320
    if (activeConnectionId && fileManagerVisible[activeConnectionId]) width += 360
    if (apiLogVisible) width += 380
    return width
  }
  const rightPanelWidth = getRightPanelWidth()

  return (
    <>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        marginRight: rightPanelWidth,
        transition: 'margin-right 0.3s ease',
        width: `calc(100% - ${rightPanelWidth}px)`
      }}>
        <Tabs
          activeKey={activeConnectionId || undefined}
          onChange={setActiveConnection}
          items={connectionItems}
          style={{ height: '100%' }}
          tabBarStyle={{ margin: 0, padding: '0 12px', background: 'var(--color-bg-elevated)' }}
          destroyInactiveTabPane={false}
        />
      </div>
      <MonitorPanel visible={monitorVisible} connectionId={activeConnectionId || ''} onClose={() => setMonitorVisible(false)} />
      {activeConnectionId && (
        <>
          <FileManagerPanel
            connectionId={activeConnectionId}
            visible={!!fileManagerVisible[activeConnectionId]}
            onClose={() => setFileManagerVisible(activeConnectionId, false)}
          />
        </>
      )}
      <McpLogPanel visible={apiLogVisible} onClose={() => setApiLogVisible(false)} />
    </>
  )
}

export default Terminal
