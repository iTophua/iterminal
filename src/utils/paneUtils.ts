import type { SplitPane, Session } from '../stores/terminalStore'

/**
 * 获取分屏中的所有会话
 */
export function getAllSessions(pane: SplitPane): Session[] {
  if (pane.children) {
    return pane.children.flatMap(child => getAllSessions(child))
  }
  return pane.sessions
}

/**
 * 获取分屏中当前活动的会话
 */
export function getActiveSessionInPane(pane: SplitPane): Session | null {
  if (pane.children) {
    const targetPaneId = pane.activePaneId
    if (targetPaneId) {
      const findPaneById = (p: SplitPane): SplitPane | null => {
        if (p.id === targetPaneId) return p
        if (p.children) {
          for (const child of p.children) {
            const found = findPaneById(child)
            if (found) return found
          }
        }
        return null
      }
      const targetPane = findPaneById(pane)
      if (targetPane) {
        if (targetPane.activeSessionId) {
          return targetPane.sessions.find(s => s.id === targetPane.activeSessionId) || null
        }
        return targetPane.sessions[0] || null
      }
    }
    for (const child of pane.children) {
      const active = getActiveSessionInPane(child)
      if (active) return active
    }
    return null
  }
  if (pane.activeSessionId) {
    return pane.sessions.find(s => s.id === pane.activeSessionId) || null
  }
  return pane.sessions[0] || null
}

/**
 * 根据会话 ID 查找包含该会话的分屏
 */
export function findPaneBySessionId(pane: SplitPane, sessionId: string): SplitPane | null {
  if (pane.sessions.some(s => s.id === sessionId)) {
    return pane
  }
  if (pane.children) {
    for (const child of pane.children) {
      const found = findPaneBySessionId(child, sessionId)
      if (found) return found
    }
  }
  return null
}

/**
 * 检查分屏是否有子分屏
 */
export function hasSplitChildren(pane: SplitPane | null): boolean {
  return !!(pane?.children && pane.children.length > 0)
}

/**
 * 获取分屏中所有可见的会话
 */
export function getVisibleSessions(pane: SplitPane): Session[] {
  if (pane.children && pane.children.length > 0) {
    return pane.children.flatMap(child => getVisibleSessions(child))
  }
  return pane.sessions
}
