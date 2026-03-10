import { create } from 'zustand'

// 连接信息
export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  group: string
  tags: string[]
  status: 'online' | 'offline' | 'connecting'
}

// 会话信息
export interface Session {
  id: string
  connectionId: string
  shellId: string
  title: string
}

// 已连接的连接信息（包含多个会话）
export interface ConnectedConnection {
  connectionId: string
  connection: Connection
  sessions: Session[]
  activeSessionId: string | null
}

interface TerminalState {
  // 已连接的连接列表
  connectedConnections: ConnectedConnection[]
  // 当前激活的连接 ID
  activeConnectionId: string | null
  
  // 添加连接
  addConnection: (connection: Connection, shellId: string) => string
  // 添加会话
  addSession: (connectionId: string, shellId: string) => string
  // 关闭会话
  closeSession: (connectionId: string, sessionId: string) => void
  // 关闭连接
  closeConnection: (connectionId: string) => void
  // 设置激活的连接
  setActiveConnection: (connectionId: string | null) => void
  // 设置激活的会话
  setActiveSession: (connectionId: string, sessionId: string) => void
  // 获取当前激活的会话
  getActiveSession: () => Session | null
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  connectedConnections: [],
  activeConnectionId: null,

  addConnection: (connection, shellId) => {
    const sessionId = Date.now().toString()
    const newSession: Session = {
      id: sessionId,
      connectionId: connection.id,
      shellId,
      title: '会话1',
    }
    set((state) => ({
      connectedConnections: [
        ...state.connectedConnections,
        {
          connectionId: connection.id,
          connection,
          sessions: [newSession],
          activeSessionId: sessionId,
        }
      ],
      activeConnectionId: connection.id,
    }))
    
    return sessionId
  },

  addSession: (connectionId, shellId) => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
    if (!conn) return ''
    
    const sessionId = Date.now().toString()
    const sessionCount = conn.sessions.length + 1
    const newSession: Session = {
      id: sessionId,
      connectionId,
      shellId,
      title: `会话${sessionCount}`,
    }
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? {
              ...c,
              sessions: [...c.sessions, newSession],
              activeSessionId: sessionId,
            }
          : c
      ),
    }))
    
    return sessionId
  },

  closeSession: (connectionId, sessionId) => {
    set((state) => {
      const conn = state.connectedConnections.find(c => c.connectionId === connectionId)
      if (!conn) return state
      
      const newSessions = conn.sessions.filter(s => s.id !== sessionId)
      
      // 如果没有会话了，移除整个连接
      if (newSessions.length === 0) {
        return {
          connectedConnections: state.connectedConnections.filter(c => c.connectionId !== connectionId),
          activeConnectionId: state.activeConnectionId === connectionId 
            ? (state.connectedConnections.length > 1 
              ? state.connectedConnections.find(c => c.connectionId !== connectionId)?.connectionId || null 
              : null)
            : state.activeConnectionId,
        }
      }
      
      // 更新会话列表
      const newActiveSessionId = conn.activeSessionId === sessionId
        ? newSessions[0].id
        : conn.activeSessionId
      
      return {
        connectedConnections: state.connectedConnections.map(c =>
          c.connectionId === connectionId
            ? { ...c, sessions: newSessions, activeSessionId: newActiveSessionId }
            : c
        ),
      }
    })
  },

  closeConnection: (connectionId) => {
    set((state) => {
      const newConnections = state.connectedConnections.filter(c => c.connectionId !== connectionId)
      const newActiveId = state.activeConnectionId === connectionId
        ? (newConnections.length > 0 ? newConnections[0].connectionId : null)
        : state.activeConnectionId
      
      return {
        connectedConnections: newConnections,
        activeConnectionId: newActiveId,
      }
    })
  },

  setActiveConnection: (connectionId) => {
    set({ activeConnectionId: connectionId })
  },

  setActiveSession: (connectionId, sessionId) => {
    set((state) => ({
      connectedConnections: state.connectedConnections.map(c =>
        c.connectionId === connectionId
          ? { ...c, activeSessionId: sessionId }
          : c
      ),
      activeConnectionId: connectionId,
    }))
  },

  getActiveSession: () => {
    const state = get()
    const conn = state.connectedConnections.find(c => c.connectionId === state.activeConnectionId)
    if (!conn || !conn.activeSessionId) return null
    return conn.sessions.find(s => s.id === conn.activeSessionId) || null
  },
}))