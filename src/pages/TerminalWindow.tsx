import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ConfigProvider, App } from 'antd'
import 'xterm/css/xterm.css'
import { 
  useTerminals, 
  useTerminalSearch, 
  TerminalSession,
  SessionInfo,
  SplitPaneState,
} from '../hooks/terminal'
import { 
  TerminalSearchBar, 
  TerminalPane, 
  TerminalContainer,
  TerminalToolbar,
  SessionTabItem,
} from '../components/terminal'
import FileManagerPanel from '../components/FileManagerPanel'
import MonitorPanel from '../components/MonitorPanel'

function TerminalWindow() {
  const [searchParams] = useSearchParams()
  const { message: msg } = App.useApp()
  
  const connectionId = searchParams.get('connectionId') || ''
  const sessionsParam = searchParams.get('sessions') || '[]'
  const connectionName = searchParams.get('name') || 'Terminal'
  
  const [panes, setPanes] = useState<SplitPaneState[]>([])
  const [activePaneId, setActivePaneId] = useState<string | null>(null)
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical' | null>(null)
  
  const [fileManagerVisible, setFileManagerVisible] = useState(false)
  const [monitorVisible, setMonitorVisible] = useState(false)
  
  const {
    initTerminal,
    destroyTerminal,
    getTerminal,
    setRef,
    getRef,
    fitAll,
  } = useTerminals()
  
  const {
    visible: searchVisible,
    text: searchText,
    mode: searchMode,
    setText: setSearchText,
    setMode: setSearchMode,
    handleSearch,
    clearSearch,
    toggleVisible,
  } = useTerminalSearch()
  
  const paneCounterRef = useRef(0)
  
  const generatePaneId = useCallback(() => {
    paneCounterRef.current += 1
    return `pane-${Date.now()}-${paneCounterRef.current}`
  }, [])
  
  const getActivePane = useCallback((): SplitPaneState | null => {
    return panes.find(p => p.id === activePaneId) || null
  }, [panes, activePaneId])
  
  const getActiveSessionId = useCallback((): string | null => {
    const pane = getActivePane()
    return pane?.activeSessionId || null
  }, [getActivePane])
  
  useEffect(() => {
    document.title = `iTerminal - ${connectionName}`
  }, [connectionName])
  
  useEffect(() => {
    try {
      const parsed: SessionInfo[] = JSON.parse(decodeURIComponent(sessionsParam))
      if (parsed.length > 0) {
        const paneId = generatePaneId()
        setPanes([{
          id: paneId,
          sessions: parsed,
          activeSessionId: parsed[0].id,
        }])
        setActivePaneId(paneId)
      }
    } catch (e) {
      console.error('Failed to parse sessions:', e)
    }
  }, [sessionsParam, generatePaneId])
  
  useEffect(() => {
    panes.forEach(pane => {
      pane.sessions.forEach(session => {
        const container = getRef(`${pane.id}-${session.id}`)
        if (container) {
          const terminalSession: TerminalSession = {
            id: `${pane.id}-${session.id}`,
            shellId: session.shellId,
            connectionId: connectionId,
          }
          initTerminal(terminalSession, container)
        }
      })
    })
  }, [panes, connectionId, initTerminal, getRef])
  
  useEffect(() => {
    setTimeout(() => fitAll(), 100)
  }, [panes, fitAll])
  
  const onSearch = (direction: 'next' | 'prev') => {
    const sessionId = getActiveSessionId()
    if (sessionId) {
      const instance = getTerminal(sessionId)
      if (instance) {
        handleSearch(instance.search, direction)
      }
    }
  }
  
  const onClearSearch = () => {
    const sessionId = getActiveSessionId()
    if (sessionId) {
      const instance = getTerminal(sessionId)
      if (instance) {
        clearSearch(instance.search)
      }
    }
  }
  
  const handleDisconnect = async () => {
    try {
      await invoke('disconnect_ssh', { id: connectionId })
      getCurrentWindow().close()
    } catch (err) {
      msg.error(`断开连接失败: ${err}`)
    }
  }
  
  const handleNewSession = useCallback(async (paneId: string) => {
    try {
      const shellId = await invoke<string>('get_shell', { id: connectionId })
      const newSession: SessionInfo = {
        id: `session-${Date.now()}`,
        shellId,
        title: `会话 ${(panes.reduce((sum, p) => sum + p.sessions.length, 0) + 1)}`,
      }
      
      setPanes(prev => prev.map(pane => {
        if (pane.id === paneId) {
          return {
            ...pane,
            sessions: [...pane.sessions, newSession],
            activeSessionId: newSession.id,
          }
        }
        return pane
      }))
    } catch (err) {
      msg.error(`创建会话失败: ${err}`)
    }
  }, [connectionId, panes, msg])
  
  const handleCloseSession = useCallback((paneId: string, sessionId: string) => {
    const pane = panes.find(p => p.id === paneId)
    if (!pane) return
    
    const session = pane.sessions.find(s => s.id === sessionId)
    if (session?.shellId) {
      destroyTerminal(`${paneId}-${sessionId}`, session.shellId)
    }
    
    setPanes(prev => {
      const newPanes = prev.map(p => {
        if (p.id === paneId) {
          const remaining = p.sessions.filter(s => s.id !== sessionId)
          let newActiveId = p.activeSessionId
          if (p.activeSessionId === sessionId) {
            newActiveId = remaining.length > 0 
              ? (remaining[remaining.length - 1]?.id || null)
              : null
          }
          return { ...p, sessions: remaining, activeSessionId: newActiveId }
        }
        return p
      }).filter(p => p.sessions.length > 0)
      
      if (newPanes.length === 0) {
        invoke('disconnect_ssh', { id: connectionId }).catch(() => {})
        getCurrentWindow().close()
        return prev
      }
      
      if (!newPanes.find(p => p.id === activePaneId)) {
        setActivePaneId(newPanes[0]?.id || null)
      }
      
      if (newPanes.length === 1) {
        setSplitDirection(null)
      }
      
      return newPanes
    })
  }, [panes, destroyTerminal, connectionId, activePaneId])
  
  const handleSplit = useCallback((direction: 'horizontal' | 'vertical') => {
    if (panes.length >= 2) {
      msg.info('当前只支持两个分屏')
      return
    }
    
    setSplitDirection(direction)
    
    setTimeout(async () => {
      try {
        const shellId = await invoke<string>('get_shell', { id: connectionId })
        const newPaneId = generatePaneId()
        const newSession: SessionInfo = {
          id: `session-${Date.now()}`,
          shellId,
          title: `会话 ${panes.reduce((sum, p) => sum + p.sessions.length, 0) + 1}`,
        }
        
        setPanes(prev => [...prev, {
          id: newPaneId,
          sessions: [newSession],
          activeSessionId: newSession.id,
        }])
        setActivePaneId(newPaneId)
      } catch (err) {
        msg.error(`分屏失败: ${err}`)
      }
    }, 100)
  }, [panes, connectionId, generatePaneId, msg])
  
  const setActiveSession = useCallback((paneId: string, sessionId: string) => {
    setPanes(prev => prev.map(p => 
      p.id === paneId ? { ...p, activeSessionId: sessionId } : p
    ))
    setActivePaneId(paneId)
  }, [])
  
  const sessionsToTabs = (sessions: SessionInfo[]): SessionTabItem[] => 
    sessions.map(s => ({ id: s.id, title: s.title }))

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-container)',
    }}>
      <TerminalToolbar
        title={connectionName}
        showFileManager={fileManagerVisible}
        showMonitor={monitorVisible}
        onToggleFileManager={() => {
          setFileManagerVisible(v => !v)
          if (!fileManagerVisible) setMonitorVisible(false)
        }}
        onToggleMonitor={() => {
          setMonitorVisible(v => !v)
          if (!monitorVisible) setFileManagerVisible(false)
        }}
        onToggleSearch={toggleVisible}
        onDisconnect={handleDisconnect}
        onSplit={handleSplit}
      />
      
      <TerminalSearchBar
        visible={searchVisible}
        text={searchText}
        mode={searchMode}
        onTextChange={setSearchText}
        onModeChange={setSearchMode}
        onSearch={onSearch}
        onClear={onClearSearch}
      />
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ 
          flex: 1, 
          display: 'flex',
          flexDirection: splitDirection === 'vertical' ? 'column' : 'row',
          overflow: 'hidden',
        }}>
          {panes.map((pane, index) => (
            <TerminalPane
              key={pane.id}
              sessions={sessionsToTabs(pane.sessions)}
              activeSessionId={pane.activeSessionId}
              onSessionChange={(sessionId) => setActiveSession(pane.id, sessionId)}
              onNewSession={() => handleNewSession(pane.id)}
              onCloseSession={(sessionId) => handleCloseSession(pane.id, sessionId)}
              onPaneClick={() => setActivePaneId(pane.id)}
              style={{
                borderRight: panes.length > 1 && index === 0 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {pane.sessions.map(s => (
                <TerminalContainer
                  key={s.id}
                  ref={el => setRef(`${pane.id}-${s.id}`, el)}
                  visible={pane.activeSessionId === s.id}
                />
              ))}
            </TerminalPane>
          ))}
        </div>
        
        <div style={{
          width: (fileManagerVisible || monitorVisible) ? 360 : 0,
          height: '100%',
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.2s ease',
        }}>
          {fileManagerVisible && (
            <FileManagerPanel
              connectionId={connectionId}
              visible={fileManagerVisible}
              onClose={() => setFileManagerVisible(false)}
            />
          )}
          {monitorVisible && (
            <MonitorPanel
              connectionId={connectionId}
              visible={monitorVisible}
              onClose={() => setMonitorVisible(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function TerminalWindowPage() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00b96b',
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