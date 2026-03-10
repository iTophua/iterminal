import { useEffect, useRef, useCallback } from 'react'
import { Tabs, message, Tooltip, Space } from 'antd'
import { CloseOutlined, PlusOutlined, FullscreenOutlined, ScissorOutlined, SearchOutlined } from '@ant-design/icons'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { invoke } from '@tauri-apps/api/core'
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
  const readingRef = useRef<{ [key: string]: boolean }>({})
  const initializedRef = useRef<Set<string>>(new Set())

  const activeConnection = connectedConnections.find(c => c.connectionId === activeConnectionId)
  const activeSession = activeConnection?.sessions.find(s => s.id === activeConnection?.activeSessionId)

  // 初始化终端
  useEffect(() => {
    if (!activeSession) return

    const key = `${activeSession.connectionId}_${activeSession.id}`
    
    if (initializedRef.current.has(key)) {
      const addon = fitAddons.current[key]
      if (addon) setTimeout(() => { try { addon.fit() } catch {} }, 50)
      return
    }

    const container = terminalRefs.current[key]
    if (!container) return

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#000000', foreground: '#FFFFFF', cursor: '#FFFFFF' },
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    container.innerHTML = ''
    terminal.open(container)
    
    terminal.onData(data => {
      invoke('write_shell', { id: activeSession.shellId, data }).catch(console.error)
    })

    setTimeout(() => { try { fitAddon.fit() } catch {} }, 100)
    
    terminalInstances.current[key] = terminal
    fitAddons.current[key] = fitAddon
    initializedRef.current.add(key)
    readingRef.current[key] = true

    const readLoop = async () => {
      while (readingRef.current[key]) {
        try {
          const result = await invoke<{ data: string; eof: boolean }>('read_shell', { id: activeSession.shellId })
          if (result?.data && terminalInstances.current[key]) {
            terminalInstances.current[key].write(result.data)
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50))
      }
    }
    readLoop()

    const interval = setInterval(() => { try { fitAddon.fit() } catch {} }, 5000)
    return () => clearInterval(interval)
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

    readingRef.current[key] = false
    if (sess?.shellId) await invoke('close_shell', { id: sess.shellId }).catch(() => {})
    if (terminalInstances.current[key]) {
      terminalInstances.current[key].dispose()
      delete terminalInstances.current[key]
    }
    delete fitAddons.current[key]
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
      readingRef.current[key] = false
      if (s.shellId) await invoke('close_shell', { id: s.shellId }).catch(() => {})
      if (terminalInstances.current[key]) {
        terminalInstances.current[key].dispose()
        delete terminalInstances.current[key]
      }
      delete fitAddons.current[key]
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
              <Tooltip title="复制"><span style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}><ScissorOutlined /></span></Tooltip>
              <Tooltip title="搜索"><span style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}><SearchOutlined /></span></Tooltip>
              <Tooltip title="全屏"><span style={{ color: '#999', cursor: 'pointer', padding: '4px 8px' }}><FullscreenOutlined /></span></Tooltip>
            </Space>
          </div>
          <div ref={el => { terminalRefs.current[`${conn.connectionId}_${s.id}`] = el }} style={{ flex: 1, background: '#000' }} />
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
      />
    </div>
  )
}

export default Terminal