import type { SplitPane, Session, Connection, ConnectedConnection } from '../stores/terminalStore'

export interface SerializedSplitPane {
  id: string
  splitDirection?: 'horizontal' | 'vertical'
  children?: SerializedSplitPane[]
  sizes?: number[]
  activePaneId?: string
}

export interface SerializedSession {
  id: string
  title: string
}

export interface SerializedConnection {
  connectionId: string
  connection: Connection
  rootPane: SerializedSplitPane
  sessions: SerializedSession[]
  fileManagerVisible?: boolean
  currentPath?: string
}

/**
 * 序列化分屏结构（不包含 shellId，因为需要重新创建连接）
 */
export function serializePane(pane: SplitPane): SerializedSplitPane {
  const result: SerializedSplitPane = {
    id: pane.id,
  }

  if (pane.splitDirection) {
    result.splitDirection = pane.splitDirection
    result.children = pane.children?.map(serializePane)
    if (pane.sizes) result.sizes = pane.sizes
    if (pane.activePaneId) result.activePaneId = pane.activePaneId
  }

  return result
}

/**
 * 反序列化分屏结构（会话的 shellId 为空，需要重新创建）
 */
export function deserializePane(serialized: SerializedSplitPane): SplitPane {
  const result: SplitPane = {
    id: serialized.id,
    sessions: [],
    activeSessionId: null,
  }

  if (serialized.splitDirection) {
    result.splitDirection = serialized.splitDirection
    if (serialized.children) {
      result.children = serialized.children.map(deserializePane)
    }
    if (serialized.sizes) result.sizes = serialized.sizes
    if (serialized.activePaneId) result.activePaneId = serialized.activePaneId
  }

  return result
}

/**
 * 序列化连接数据，用于传递给新窗口
 */
export function serializeConnection(conn: ConnectedConnection): SerializedConnection {
  const allSessions = getAllSessions(conn.rootPane)

  return {
    connectionId: conn.connectionId,
    connection: conn.connection,
    rootPane: serializePane(conn.rootPane),
    sessions: allSessions.map(s => ({
      id: s.id,
      title: s.title,
    })),
  }
}

/**
 * 反序列化并重建连接结构（需要在新窗口中重新创建 SSH 连接）
 */
export function deserializeConnection(
  data: SerializedConnection,
  newConnectionId: string
): { connection: Connection; rootPane: SplitPane } {
  const rootPane = deserializePane(data.rootPane)

  // 重建会话信息（但不创建 shellId，需要重新连接）
  const sessionMap = new Map(data.sessions.map(s => [s.id, s]))

  const rebuildSessions = (pane: SplitPane) => {
    if (pane.children) {
      pane.children.forEach(rebuildSessions)
    } else {
      // 找到该 pane 对应的会话
      const sessionInfo = sessionMap.get(pane.id)
      if (sessionInfo) {
        pane.sessions = [{
          id: sessionInfo.id,
          connectionId: newConnectionId,
          shellId: '', // 新窗口需要重新创建
          title: sessionInfo.title,
        }]
        pane.activeSessionId = sessionInfo.id
      }
    }
  }

  rebuildSessions(rootPane)

  return {
    connection: data.connection,
    rootPane,
  }
}

/**
 * 获取分屏中的所有会话
 */
function getAllSessions(pane: SplitPane): Session[] {
  if (pane.children) {
    return pane.children.flatMap(child => getAllSessions(child))
  }
  return pane.sessions
}
