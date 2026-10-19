import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiOutlined,
  ArrowRightOutlined,
  RobotOutlined,
  DashboardOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { ConnectedConnection, Connection } from '../../../../stores/terminalStore'

export interface PaletteAction {
  key: string
  section: '主机' | '会话' | '片段' | '命令' | '视图'
  label: string
  hint?: string
  icon?: React.ReactNode
  keywords?: string
  run: () => void
}

interface CommandPaletteProps {
  visible: boolean
  onClose: () => void
  allConnections: Connection[]
  connectedConnections: ConnectedConnection[]
  /** 会话跳转 */
  onJumpSession: (sessionKey: string) => void
  /** 未连接主机快速连接 */
  onConnectHost: (conn: Connection) => void
  /** 运行命令到焦点窗口 */
  onRunCommand: (cmd: string) => void
  /** 命令历史（焦点连接） */
  historyCommands: { text: string; count: number }[]
  onToggleDrawer: (tab: 'files' | 'monitor' | 'docker' | 'ports' | 'ai') => void
  /** 打开驾驶舱内的连接管理浮层 */
  onOpenConnections: () => void
  broadcastEnabled: boolean
  onToggleBroadcast: () => void
  /** 把连接移到独立窗口 */
  onDetachToNewWindow: (connectionId: string) => void
  /** 命令片段（Pro），空数组不显示该分区 */
  snippets: { title: string; command: string }[]
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return true
  if (t.includes(q)) return true
  // 简单子序列匹配
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return false
}

/**
 * ⌘K 命令面板：主机连接 / 会话跳转 / 命令历史 / 布局与面板开关的统一入口。
 */
export function CommandPalette({
  visible,
  onClose,
  allConnections,
  connectedConnections,
  onJumpSession,
  onConnectHost,
  onRunCommand,
  historyCommands,
  onToggleDrawer,
  onOpenConnections,
  broadcastEnabled,
  onToggleBroadcast,
  onDetachToNewWindow,
  snippets,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [visible])

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = []

    for (const conn of allConnections) {
      const connected = connectedConnections.some(c => c.connectionId === conn.id)
      list.push({
        key: `host-${conn.id}`,
        section: connected ? '主机' : '主机',
        label: connected ? `跳转 ${conn.name}` : `连接 ${conn.name}`,
        hint: `${conn.username}@${conn.host}${connected ? ' · 已连接' : ''}`,
        icon: <ArrowRightOutlined />,
        keywords: `${conn.name} ${conn.host} ${conn.username} ${conn.group} ${(conn.tags || []).join(' ')} ${connected ? '跳转' : '连接'}`,
        run: () => {
          if (connected) {
            const c = connectedConnections.find(x => x.connectionId === conn.id)!
            const first = c.rootPane.sessions[0]
            if (first) onJumpSession(`${conn.id}_${first.id}`)
          } else {
            onConnectHost(conn)
          }
        },
      })
    }

    for (const c of connectedConnections) {
      list.push({
        key: `detach-${c.connectionId}`,
        section: '主机',
        label: `在新窗口打开 ${c.connection.name}`,
        hint: '迁移其全部会话',
        keywords: `独立窗口 拖出 ${c.connection.name} ${c.connection.host} ${c.connection.username}`,
        run: () => onDetachToNewWindow(c.connectionId),
      })
    }

    for (const c of connectedConnections) {
      const walk = (pane: any) => {
        for (const sess of pane.sessions ?? []) {
          list.push({
            key: `sess-${c.connectionId}-${sess.id}`,
            section: '会话',
            label: `${c.connection.name} · ${sess.title}`,
            hint: `${c.connection.username}@${c.connection.host}`,
            keywords: `${sess.title} ${c.connection.name} ${c.connection.host} ${c.connection.username}`,
            run: () => onJumpSession(`${c.connectionId}_${sess.id}`),
          })
        }
        for (const child of pane.children ?? []) walk(child)
      }
      walk(c.rootPane)
    }

    for (const h of historyCommands.slice(0, 8)) {
      list.push({
        key: `hist-${h.text}`,
        section: '命令',
        label: h.text.length > 46 ? h.text.slice(0, 46) + '…' : h.text,
        hint: `运行 · 历史 ${h.count} 次`,
        icon: <ReloadOutlined />,
        keywords: h.text,
        run: () => onRunCommand(h.text + '\r'),
      })
    }

    for (const sn of snippets) {
      list.push({
        key: `snippet-${sn.title}`,
        section: '片段',
        label: sn.title.length > 40 ? sn.title.slice(0, 40) + '…' : sn.title,
        hint: sn.command.length > 30 ? sn.command.slice(0, 30) + '…' : sn.command,
        keywords: sn.command,
        run: () => onRunCommand(sn.command + '\r'),
      })
    }

    list.push(
      {
        key: 'broadcast',
        section: '命令',
        label: broadcastEnabled ? '关闭输入广播' : '开启输入广播（击键同步到所有终端）',
        run: onToggleBroadcast,
      },
      { key: 'panel-monitor', section: '视图', label: '打开监控面板', icon: <DashboardOutlined />, run: () => onToggleDrawer('monitor') },
      { key: 'panel-files', section: '视图', label: '打开文件管理', run: () => onToggleDrawer('files') },
      { key: 'panel-docker', section: '视图', label: '打开 Docker 面板', icon: <ApiOutlined />, run: () => onToggleDrawer('docker') },
      { key: 'panel-ai', section: '视图', label: '打开 AI 助手', icon: <RobotOutlined />, run: () => onToggleDrawer('ai') },
      { key: 'goto-connections', section: '视图', label: '打开连接管理', icon: <PlusOutlined />, run: onOpenConnections },
    )
    return list
  }, [allConnections, connectedConnections, historyCommands, onJumpSession, onConnectHost, onRunCommand, onToggleDrawer, onOpenConnections, broadcastEnabled, onToggleBroadcast, onDetachToNewWindow, snippets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // 无输入时优先：主机 > 会话 > 命令 > 视图
      const order = { '主机': 0, '会话': 1, '命令': 2, '片段': 3, '视图': 4 } as const
      return [...actions].sort((a, b) => order[a.section] - order[b.section]).slice(0, 12)
    }
    // 相关性分级：主机名称/IP 直接命中(0) > 其他包含命中(1) > 子序列模糊命中(2)
    const rank = (a: PaletteAction): number => {
      if (a.section === '主机'
        && (a.label.toLowerCase().includes(q) || (a.keywords ?? '').toLowerCase().includes(q))) return 0
      if (`${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`.toLowerCase().includes(q)) return 1
      return 2
    }
    return actions
      .filter(a => fuzzyMatch(query, `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`))
      .map(a => ({ a, r: rank(a) }))
      .sort((x, y) => x.r - y.r)
      .slice(0, 12)
      .map(x => x.a)
  }, [actions, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const runSelected = useCallback(() => {
    const item = filtered[selectedIndex]
    if (item) {
      item.run()
      onClose()
    }
  }, [filtered, selectedIndex, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runSelected()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [filtered, runSelected, onClose])

  if (!visible) return null

  return (
    <div
      className="ck-palette-mask"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="ck-palette" role="dialog" aria-label="命令面板">
        <div className="ck-palette-in">
          <SearchOutlined style={{ color: 'var(--ck-t3)', fontSize: 15 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="连接主机（支持名称 / IP）、跳转会话、运行历史命令…"
            aria-label="搜索命令"
          />
          <span className="ck-palette-esc">esc</span>
        </div>
        <div className="ck-palette-list">
          {filtered.map((a, i) => (
            <div
              key={a.key}
              className={`ck-palette-item${i === selectedIndex ? ' sel' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={runSelected}
            >
              <span className="sec">{a.section}</span>
              {a.icon ? <span className="ic">{a.icon}</span> : <span className="ic" />}
              <span className="lb">{a.label}</span>
              {a.hint && <span className="hint">{a.hint}</span>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="ck-palette-empty">没有匹配的结果</div>
          )}
        </div>
      </div>
    </div>
  )
}
