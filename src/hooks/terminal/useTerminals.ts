import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useThemeStore } from '../../stores/themeStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { resolveTerminalTheme } from '../../styles/themes/terminal-themes'

export interface TerminalSession {
  id: string
  shellId: string
  connectionId: string
}

export interface TerminalInstance {
  term: XTerm
  fit: FitAddon
  search: SearchAddon
}

export function useTerminals() {
  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})
  const terminals = useRef<{ [key: string]: TerminalInstance }>({})
  const unlisteners = useRef<{ [key: string]: UnlistenFn }>({})
  const resizeObservers = useRef<{ [key: string]: ResizeObserver }>({})
  
  const terminalThemeKey = useThemeStore(state => state.terminalTheme)
  const appTheme = useThemeStore(state => state.appTheme)
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  
  const getTerminalTheme = useCallback(() => {
    return resolveTerminalTheme(appTheme, terminalThemeKey)
  }, [appTheme, terminalThemeKey])
  
  const initTerminal = useCallback(async (
    session: TerminalSession,
    container: HTMLDivElement
  ): Promise<TerminalInstance | null> => {
    if (!session.shellId || !container) return null
    
    const existing = terminals.current[session.id]
    if (existing) {
      if (existing.term.element && !container.contains(existing.term.element)) {
        container.innerHTML = ''
        container.appendChild(existing.term.element)
      }
      return existing
    }
    
    const terminalTheme = getTerminalTheme()
    
    const term = new XTerm({
      theme: terminalTheme,
      fontFamily: terminalSettings.fontFamily || 'Menlo, Monaco, "Courier New", monospace',
      fontSize: terminalSettings.fontSize || 13,
      cursorStyle: terminalSettings.cursorStyle || 'block',
      cursorBlink: terminalSettings.cursorBlink !== false,
      scrollback: terminalSettings.scrollback || 10000,
      allowProposedApi: true,
    })
    
    const fit = new FitAddon()
    const search = new SearchAddon()
    
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(container)
    
    const instance: TerminalInstance = { term, fit, search }
    terminals.current[session.id] = instance
    
    setTimeout(() => fit.fit(), 100)
    
    const unlisten = await listen<string>(`shell-output-${session.shellId}`, (event) => {
      const data = event.payload
      if (data && terminals.current[session.id]) {
        terminals.current[session.id].term.write(data)
      }
    })
    unlisteners.current[session.id] = unlisten
    
    term.onData((data) => {
      invoke('write_shell', { id: session.connectionId, data }).catch(() => {})
    })
    
    term.onResize(({ cols, rows }) => {
      invoke('resize_shell', { id: session.connectionId, cols, rows }).catch(() => {})
    })
    
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {}
    })
    resizeObserver.observe(container)
    resizeObservers.current[session.id] = resizeObserver
    
    return instance
  }, [terminalSettings, getTerminalTheme])
  
  const destroyTerminal = useCallback((sessionId: string, shellId?: string) => {
    if (shellId) {
      invoke('close_shell', { id: shellId }).catch(() => {})
    }
    
    if (unlisteners.current[sessionId]) {
      unlisteners.current[sessionId]()
      delete unlisteners.current[sessionId]
    }
    
    if (terminals.current[sessionId]) {
      terminals.current[sessionId].term.dispose()
      delete terminals.current[sessionId]
    }
    
    if (resizeObservers.current[sessionId]) {
      resizeObservers.current[sessionId].disconnect()
      delete resizeObservers.current[sessionId]
    }
  }, [])
  
  const fitTerminal = useCallback((sessionId: string) => {
    try {
      terminals.current[sessionId]?.fit.fit()
    } catch {}
  }, [])
  
  const fitAll = useCallback(() => {
    Object.values(terminals.current).forEach(({ fit }) => {
      try { fit.fit() } catch {}
    })
  }, [])
  
  const getTerminal = useCallback((sessionId: string): TerminalInstance | null => {
    return terminals.current[sessionId] || null
  }, [])
  
  const setRef = useCallback((sessionId: string, el: HTMLDivElement | null) => {
    terminalRefs.current[sessionId] = el
  }, [])
  
  const getRef = useCallback((sessionId: string): HTMLDivElement | null => {
    return terminalRefs.current[sessionId] || null
  }, [])
  
  useEffect(() => {
    const terminalTheme = getTerminalTheme()
    Object.values(terminals.current).forEach(({ term }) => {
      term.options.theme = terminalTheme
      term.refresh(0, term.rows - 1)
    })
  }, [terminalThemeKey, appTheme, getTerminalTheme])
  
  useEffect(() => {
    const handleResize = () => fitAll()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [fitAll])
  
  useEffect(() => {
    return () => {
      Object.values(unlisteners.current).forEach(fn => fn())
      Object.values(terminals.current).forEach(({ term }) => term.dispose())
      Object.values(resizeObservers.current).forEach(obs => obs.disconnect())
    }
  }, [])
  
  return {
    initTerminal,
    destroyTerminal,
    fitTerminal,
    fitAll,
    getTerminal,
    setRef,
    getRef,
  }
}