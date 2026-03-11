import { useEffect, useRef, useCallback } from 'react'
import { Tabs, message, Tooltip, Space } from 'antd'
import { CloseOutlined, PlusOutlined, FullscreenOutlined, ScissorOutlined, SearchOutlined } from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '../stores/terminalStore'

function Terminal() {
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const activeConnectionId = useTerminalStore(state => state.activeConnectionId)
  const setActiveConnection = useTerminalStore(state => state.setActiveConnection)
  const setActiveSession = useTerminalStore(state => state.setActiveSession)
  const addSession = useTerminalStore(state => state.addSession)
  const closeSession = useTerminalStore(state => state.closeSession)
  const closeConnection = useTerminalStore(state => state.closeConnection)

  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminalInstances = useRef<{ [key: string]: XTerm }>({})
  const fitAddons = useRef<{ [key: string]: FitAddon }>({})
  const initializedRef = useRef<Set<string>>(new Set())
  const unlistenersRef = useRef<{ [key: string]: UnlistenFn }>({})
  const resizeObserversRef = useRef<{ [key: string]: ResizeObserver }>({})

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
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: { background: '#000000', foreground: '#FFFFFF', cursor: '#FFFFFF' },
        convertEol: true,
        // 禁用本地回显，由 SSH 服务器控制回显
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
      
      // 3. 注册事件监听
      const eventName = `shell-output-${shellId}`
      
      const unlisten = await listen<string>(eventName, (event) => {
        const term = terminalInstances.current[key]
        if (term && event.payload) {
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

  if (connectedConnections.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#1E1E1E' }}>
        <p style={{ color: '#999', fontSize: 16 }}>没有活动的会话</p>
        <p style={{ color: '#666', fontSize: 14 }}>请先在连接管理中连接服务器</p>
      </div>
    )
  }

  const connectionItems = connectedConnections.map(conn => {
    const sessionItems = conn.sessions.map((s, idx) => ({
      key: s.id,
      label: (
        <span style={{ color: '#CCC' }}>
          会话{idx + 1}
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseSession(conn.connectionId, s.id) }} />
        </span>
      ),
      children: (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 12px', background: '#252526', borderBottom: '1px solid #3F3F46', height: 40 }}>
            <Space>
              <Tooltip title="复制">
                <span
                  style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}
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
                  style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}
                  onClick={() => {
                    const key = `${conn.connectionId}_${s.id}`
                    const term = terminalInstances.current[key]
                    if (term) {
                      const searchText = prompt('输入搜索内容:')
                      if (searchText) {
                        term.write(`\x1b[2J\x1b[H`)
                        message.info('搜索功能开发中')
                      }
                    }
                  }}
                >
                  <SearchOutlined />
                </span>
              </Tooltip>
              <Tooltip title="全屏">
                <span
                  style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}
                  onClick={() => {
                    const key = `${conn.connectionId}_${s.id}`
                    const container = terminalRefs.current[key]
                    if (container?.parentElement?.parentElement) {
                      const elem = container.parentElement.parentElement
                      if (document.fullscreenElement) {
                        document.exitFullscreen()
                      } else {
                        elem.requestFullscreen().then(() => {
                          setTimeout(() => {
                            fitAddons.current[key]?.fit()
                          }, 100)
                        }).catch(console.error)
                      }
                    }
                  }}
                >
                  <FullscreenOutlined />
                </span>
              </Tooltip>
            </Space>
          </div>
          <div ref={el => { terminalRefs.current[`${conn.connectionId}_${s.id}`] = el }} style={{ flex: 1, width: '100%', background: '#000', overflow: 'hidden' }} />
        </div>
      ),
    }))

    return {
      key: conn.connectionId,
      label: (
        <span style={{ color: '#CCC' }}>
          {conn.connection.username}@{conn.connection.host}
          <CloseOutlined style={{ marginLeft: 8, fontSize: 10 }} onClick={e => { e.stopPropagation(); handleCloseConnection(conn.connectionId) }} />
        </span>
      ),
      children: (
        <Tabs
          activeKey={conn.activeSessionId || undefined}
          onChange={sid => { if (sid !== '__add__') setActiveSession(conn.connectionId, sid) }}
          items={[...sessionItems, { key: '__add__', label: <span style={{ color: '#0b9' }}><PlusOutlined /> 新建会话</span>, children: <div /> }]}
          type="card"
          style={{ height: '100%' }}
          tabBarStyle={{ margin: 0, padding: '0 12px', background: '#252526' }}
          onTabClick={(key) => { if (key === '__add__') handleAddSession(conn.connectionId) }}
          destroyInactiveTabPane={false}
        />
      ),
    }
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeConnectionId || undefined}
        onChange={setActiveConnection}
        items={connectionItems}
        style={{ height: '100%' }}
        tabBarStyle={{ margin: 0, padding: '0 12px', background: '#252526' }}
        destroyInactiveTabPane={false}
      />
    </div>
  )
}

export default Terminal