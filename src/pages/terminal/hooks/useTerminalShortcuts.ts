import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTerminalStore } from '../../../stores/terminalStore'
import { getActiveSessionInPane, findPaneBySessionId } from '../../../utils/paneUtils'

interface ShortcutActions {
  onSearch: (sessionKey: string | null) => void
  onSetSearchText: (text: string) => void
  onToggleFullscreen: () => void
  onToggleShortcutHelp: () => void
  onCloseSession: (connId: string, sessId: string, paneId?: string) => void
  message: { error: (msg: string) => void; success: (msg: string) => void }
}

/**
 * 匹配快捷键
 */
function matchShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false

  const parts = shortcut.toUpperCase().split('+')
  const modifiers = ['CTRL', 'CMD', 'SHIFT', 'ALT', 'META']
  const hasModifiers = parts.some(p => modifiers.includes(p))

  const hasCtrl = parts.includes('CTRL')
  const hasCmd = parts.includes('CMD')
  const hasShift = parts.includes('SHIFT')
  const hasAlt = parts.includes('ALT')
  const hasMeta = parts.includes('META')
  const keyPart = parts.find(p => !modifiers.includes(p))

  const ctrlMatch = hasCtrl ? event.ctrlKey : (!hasModifiers ? !event.ctrlKey : true)
  const cmdMatch = hasCmd ? event.metaKey : (!hasModifiers ? !event.metaKey : true)
  const shiftMatch = hasShift ? event.shiftKey : (!hasModifiers ? !event.shiftKey : true)
  const altMatch = hasAlt ? event.altKey : (!hasModifiers ? !event.altKey : true)
  const metaMatch = hasMeta ? event.metaKey : (hasCmd ? true : (!hasModifiers ? !event.metaKey : true))

  let keyMatch = false
  if (keyPart) {
    const eventKey = event.key.toUpperCase()
    const eventCode = event.code.toUpperCase()

    keyMatch = eventKey === keyPart ||
      eventCode === 'KEY' + keyPart ||
      eventCode === keyPart ||
      (keyPart === 'ENTER' && (eventKey === 'ENTER' || eventCode === 'ENTER')) ||
      ((keyPart === 'ARROWRIGHT' || keyPart === 'RIGHT') && (eventKey === 'ARROWRIGHT' || eventCode === 'ARROWRIGHT')) ||
      ((keyPart === 'ARROWLEFT' || keyPart === 'LEFT') && (eventKey === 'ARROWLEFT' || eventCode === 'ARROWLEFT')) ||
      ((keyPart === 'ARROWUP' || keyPart === 'UP') && (eventKey === 'ARROWUP' || eventCode === 'ARROWUP')) ||
      ((keyPart === 'ARROWDOWN' || keyPart === 'DOWN') && (eventKey === 'ARROWDOWN' || eventCode === 'ARROWDOWN')) ||
      (keyPart === 'SPACE' && (eventKey === ' ' || eventCode === 'SPACE')) ||
      (keyPart === 'TAB' && (eventKey === 'TAB' || eventCode === 'TAB')) ||
      (keyPart === 'ESCAPE' && (eventKey === 'ESCAPE' || eventCode === 'ESCAPE')) ||
      (keyPart === 'BACKSPACE' && (eventKey === 'BACKSPACE' || eventCode === 'BACKSPACE')) ||
      (keyPart === 'DELETE' && (eventKey === 'DELETE' || eventCode === 'DELETE')) ||
      (keyPart === 'F1' && eventCode === 'F1') ||
      (keyPart === 'F2' && eventCode === 'F2') ||
      (keyPart === 'F3' && eventCode === 'F3') ||
      (keyPart === 'F4' && eventCode === 'F4') ||
      (keyPart === 'F5' && eventCode === 'F5') ||
      (keyPart === 'F6' && eventCode === 'F6') ||
      (keyPart === 'F7' && eventCode === 'F7') ||
      (keyPart === 'F8' && eventCode === 'F8') ||
      (keyPart === 'F9' && eventCode === 'F9') ||
      (keyPart === 'F10' && eventCode === 'F10') ||
      (keyPart === 'F11' && eventCode === 'F11') ||
      (keyPart === 'F12' && eventCode === 'F12')
  }

  return ctrlMatch && cmdMatch && shiftMatch && altMatch && metaMatch && keyMatch
}

export function useTerminalShortcuts(
  activeConnectionId: string | null,
  shortcutSettings: any,
  terminalInstances: React.MutableRefObject<{ [key: string]: any }>,
  actions: ShortcutActions
) {
  const connectedConnections = useTerminalStore(state => state.connectedConnections)
  const splitPane = useTerminalStore(state => state.splitPane)
  const addSessionToPane = useTerminalStore(state => state.addSessionToPane)
  const setActiveSessionInPane = useTerminalStore(state => state.setActiveSessionInPane)

  const { onSearch, onSetSearchText, onToggleFullscreen, onToggleShortcutHelp, onCloseSession, message } = actions

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchShortcut(e, shortcutSettings.search)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        const activeSess = activeConn ? getActiveSessionInPane(activeConn.rootPane) : null
        if (activeSess) {
          const key = `${activeSess.connectionId}_${activeSess.id}`
          const term = terminalInstances.current[key]
          if (term && term.hasSelection()) {
            onSetSearchText(term.getSelection())
          }
          onSearch(key)
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.splitHorizontal)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (activeSess && pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              const newPaneId = Date.now().toString()
              splitPane(activeConn.connectionId, pane.id, 'horizontal', newPaneId, newShellId)
            }).catch(err => {
              message.error(`分屏失败: ${err}`)
            })
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.splitVertical)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (activeSess && pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              const newPaneId = Date.now().toString()
              splitPane(activeConn.connectionId, pane.id, 'vertical', newPaneId, newShellId)
            }).catch(err => {
              message.error(`分屏失败: ${err}`)
            })
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.newSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane) {
            invoke<string>('get_shell', { id: activeConn.connectionId }).then(newShellId => {
              addSessionToPane(activeConn.connectionId, pane.id, newShellId)
            }).catch(err => {
              message.error(`新建会话失败: ${err}`)
            })
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.closeSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          if (activeSess) {
            const pane = findPaneBySessionId(activeConn.rootPane, activeSess.id)
            onCloseSession(activeConn.connectionId, activeSess.id, pane?.id)
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.nextSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane && pane.sessions.length > 1) {
            const currentIndex = pane.sessions.findIndex(s => s.id === activeSess?.id)
            const nextIndex = (currentIndex + 1) % pane.sessions.length
            setActiveSessionInPane(activeConn.connectionId, pane.id, pane.sessions[nextIndex].id)
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.prevSession)) {
        e.preventDefault()
        const activeConn = connectedConnections.find(c => c.connectionId === activeConnectionId)
        if (activeConn) {
          const activeSess = getActiveSessionInPane(activeConn.rootPane)
          const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
          if (pane && pane.sessions.length > 1) {
            const currentIndex = pane.sessions.findIndex(s => s.id === activeSess?.id)
            const prevIndex = (currentIndex - 1 + pane.sessions.length) % pane.sessions.length
            setActiveSessionInPane(activeConn.connectionId, pane.id, pane.sessions[prevIndex].id)
          }
        }
        return
      }

      if (matchShortcut(e, shortcutSettings.fullscreen)) {
        e.preventDefault()
        onToggleFullscreen()
        return
      }

      if (matchShortcut(e, shortcutSettings.shortcutHelp)) {
        e.preventDefault()
        onToggleShortcutHelp()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeConnectionId, connectedConnections, shortcutSettings, splitPane, addSessionToPane, setActiveSessionInPane, onCloseSession, onToggleFullscreen, onToggleShortcutHelp, onSearch, onSetSearchText, message, terminalInstances])
}
