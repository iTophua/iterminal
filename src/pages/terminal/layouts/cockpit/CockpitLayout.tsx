import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiOutlined,
  AppstoreOutlined,
  BgColorsOutlined,
  CloseOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DownOutlined,
  ExpandOutlined,
  FolderOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  ShrinkOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { Input } from 'antd'
import type { SearchAddon } from '@xterm/addon-search'
import {
  useTerminalStore,
  type CockpitWindowGeometry,
  type CockpitThemeName,
  type ConnectedConnection,
  type Connection,
} from '../../../../stores/terminalStore'
import { useHistoryStore } from '../../../../stores/historyStore'
import { useLicenseStore } from '../../../../stores/licenseStore'
import { listSnippets } from '../../../../services/snippets'
import { getAllSessions } from '../../../../utils/paneUtils'
import { COCKPIT_THEMES, COCKPIT_THEME_LIST } from '../../../../styles/themes/cockpit-themes'
import type { TerminalThemeColors } from '../../../../types/theme'
import { FloatingWindow } from './FloatingWindow'
import { HostWall } from './HostWall'
import { SessionDock, readTerminalPreview, type DockItem } from './SessionDock'
import { ToolDrawer, type CockpitDrawerTab } from './ToolDrawer'
import { CommandPalette } from './CommandPalette'
import { ConnectionsOverlay } from './ConnectionsOverlay'
import './cockpit.css'

export interface CockpitLayoutProps {
  connectedConnections: ConnectedConnection[]
  allConnections: Connection[]
  currentPaths: { [connectionId: string]: string }
  currentThemeColors: TerminalThemeColors
  fontFamily: string
  fontSize: number
  broadcastEnabled: boolean
  terminalRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  ghostTextElementsRef: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  terminalInstances: React.MutableRefObject<Record<string, any>>
  searchAddons: React.MutableRefObject<Record<string, SearchAddon>>
  enqueueWrite: (key: string, data: string) => void
  /** 工具抽屉状态（由 Terminal 持有，抽屉内面板的 onClose 可直接关闭） */
  drawer: { open: boolean; tab: CockpitDrawerTab }
  onDrawerChange: (d: { open: boolean; tab: CockpitDrawerTab }) => void
  onSessionContextMenu: (e: React.MouseEvent, sessionKey: string) => void
  onCloseSession: (connectionId: string, sessionId: string) => void
  onReconnect: (connectionId: string, isManual: boolean) => void
  onHostClick: (conn: Connection) => void
  onNewSession: (connectionId: string) => void
  /** 把连接拖出为独立窗口（迁移其全部会话） */
  onDetachToNewWindow: (connectionId: string) => void
  /** 终端搜索（与经典布局共享状态源） */
  activeSearchSessionKey: string | null
  setActiveSearchSessionKey: (key: string | null) => void
  searchText: string
  setSearchText: (text: string) => void
  searchMode: 'normal' | 'regex' | 'wholeWord'
  setSearchMode: (mode: 'normal' | 'regex' | 'wholeWord') => void
  drawerPanels: Partial<Record<CockpitDrawerTab, React.ReactNode>>
}

// 主机墙宽度（含左 12 + 右 8 间隙）：折叠 48 / 窄画布 232 / 常态 256
const wallWidth = (canvasW: number, collapsed: boolean) => (collapsed ? 48 : canvasW < 1000 ? 232 : 256)
const RAIL_W = 66    // 右侧工具栏（46 宽 + 12 右缘 + 8 间隙）
const DOCK_H = 90    // 底部停靠栏（68 高 + 12 底缘 + 10 间隙）

/** 驾驶舱布局：主机墙 + 浮动终端窗口 + 底部停靠栏 + 右侧工具抽屉 + ⌘K 命令面板 */
export function CockpitLayout({
  connectedConnections,
  allConnections,
  currentPaths,
  currentThemeColors,
  fontFamily,
  fontSize,
  broadcastEnabled,
  terminalRefs,
  ghostTextElementsRef,
  terminalInstances,
  searchAddons,
  enqueueWrite,
  drawer,
  onDrawerChange,
  onSessionContextMenu,
  onCloseSession,
  onReconnect,
  onHostClick,
  onNewSession,
  onDetachToNewWindow,
  activeSearchSessionKey,
  setActiveSearchSessionKey,
  searchText,
  setSearchText,
  searchMode,
  setSearchMode,
  drawerPanels,
}: CockpitLayoutProps) {
  const cockpitTheme = useTerminalStore(s => s.cockpitTheme)
  const setCockpitTheme = useTerminalStore(s => s.setCockpitTheme)
  const cockpitWindowGeometry = useTerminalStore(s => s.cockpitWindowGeometry)
  const cockpitFocusKey = useTerminalStore(s => s.cockpitFocusKey)
  const setCockpitWindowGeometry = useTerminalStore(s => s.setCockpitWindowGeometry)
  const setCockpitFocusKey = useTerminalStore(s => s.setCockpitFocusKey)
  const setActiveSession = useTerminalStore(s => s.setActiveSession)
  const setSettingsVisible = useTerminalStore(s => s.setSettingsVisible)
  const transferTasks = useTerminalStore(s => s.transferTasks)
  const wallCollapsed = useTerminalStore(s => s.cockpitWallCollapsed)
  const setWallCollapsed = useTerminalStore(s => s.setCockpitWallCollapsed)

  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 })
  const [themePopOpen, setThemePopOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  // 停靠栏缩略预览刷新节拍（读取 xterm 末行，低成本轮询）
  const [previewTick, setPreviewTick] = useState(0)
  const [snippets, setSnippets] = useState<{ title: string; command: string }[]>([])
  const toggleBroadcast = useTerminalStore(s => s.toggleBroadcast)
  const prevConnCountRef = useRef(connectedConnections.length)

  // 画布尺寸（拖拽钳制与最大化矩形依赖）
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const update = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const narrowWall = !wallCollapsed && canvasSize.w < 1000
  const wallW = wallWidth(canvasSize.w, wallCollapsed)
  const bounds = useMemo(
    () => focusMode
      ? { minX: 12, minY: 8, maxX: Math.max(340, canvasSize.w - 20), maxY: Math.max(216, canvasSize.h - 20) }
      : { minX: 12 + wallW + 8, minY: 8, maxX: Math.max(12 + wallW + 8 + 340, canvasSize.w - RAIL_W), maxY: Math.max(216, canvasSize.h - DOCK_H) },
    [canvasSize, focusMode, wallW]
  )

  // 全部会话（每会话一个浮动窗口）
  const sessions = useMemo(
    () => connectedConnections.flatMap(conn =>
      getAllSessions(conn.rootPane).map(sess => ({ conn, sess, key: `${conn.connectionId}_${sess.id}` }))
    ),
    [connectedConnections]
  )

  // 聚焦兜底：记录的焦点失效时回落到第一个会话
  const focusKey = useMemo(() => {
    if (cockpitFocusKey && sessions.some(s => s.key === cockpitFocusKey)) return cockpitFocusKey
    return sessions[0]?.key ?? null
  }, [cockpitFocusKey, sessions])
  const focusConnId = focusKey?.split('_')[0]

  const focusSession = useCallback((key: string) => {
    const [connId, sessId] = key.split('_')
    setCockpitFocusKey(key)
    // 联动活动连接：快捷键、面板、AI 上下文都跟随焦点窗口
    setActiveSession(connId, sessId)
    terminalInstances.current[key]?.focus()
  }, [setCockpitFocusKey, setActiveSession, terminalInstances])

  const commitGeometry = useCallback((key: string, geo: CockpitWindowGeometry) => {
    setCockpitWindowGeometry(key, geo)
  }, [setCockpitWindowGeometry])

  // 主机墙点击：已连接 → 聚焦该连接第一个窗口；未连接 → 发起连接
  const handleHostClick = useCallback((conn: Connection) => {
    const entry = sessions.find(s => s.conn.connectionId === conn.id)
    if (entry) {
      focusSession(entry.key)
    } else {
      onHostClick(conn)
    }
  }, [sessions, focusSession, onHostClick])

  // 停靠栏数据（含传输进度）
  const dockItems: DockItem[] = useMemo(() => sessions.map(({ conn, sess, key }) => {
    const tasks = transferTasks[conn.connectionId] ?? []
    const active = tasks.find(t => t.status === 'transferring' || t.status === 'pending')
    const progress = active && active.fileSize > 0
      ? Math.min(100, Math.round((active.transferred / active.fileSize) * 100))
      : null
    return {
      sessionKey: key,
      connectionId: conn.connectionId,
      sessionId: sess.id,
      title: conn.connection.name,
      sub: `${conn.connection.username}@${conn.connection.host}`,
      preview: active
        ? `${active.type === 'upload' ? '↑' : '↓'} ${active.fileName} ${progress}%`
        : readTerminalPreview(terminalInstances.current[key]),
      disconnected: conn.disconnected,
      focused: key === focusKey,
      transferProgress: progress,
      minimized: (cockpitWindowGeometry[key]?.minimized ?? false),
    }
  }), [sessions, focusKey, terminalInstances, transferTasks, previewTick, cockpitWindowGeometry])

  const focusedConn = connectedConnections.find(c => c.connectionId === focusConnId)
  const focusedCwd = focusConnId ? currentPaths[focusConnId] : undefined

  const themeVars = COCKPIT_THEMES[cockpitTheme].vars as React.CSSProperties

  const applyTheme = useCallback((t: CockpitThemeName) => {
    setCockpitTheme(t)
    setThemePopOpen(false)
  }, [setCockpitTheme])

  // 主题弹层点击外部关闭
  useEffect(() => {
    if (!themePopOpen) return
    const onDocClick = () => setThemePopOpen(false)
    // 延迟到当前点击事件结束后注册，避免打开动作自身立即关闭
    const timer = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', onDocClick)
    }
  }, [themePopOpen])

  const openDrawerTab = useCallback((tab: CockpitDrawerTab) => {
    onDrawerChange(drawer.open && drawer.tab === tab ? { ...drawer, open: false } : { open: true, tab })
  }, [drawer, onDrawerChange])

  // 命令面板打开时加载片段（Pro 功能）
  useEffect(() => {
    if (!paletteOpen) return
    if (!useLicenseStore.getState().isFeatureAvailable('snippets')) {
      setSnippets([])
      return
    }
    listSnippets()
      .then(list => setSnippets(list.slice(0, 8).map(x => ({ title: x.title, command: x.command }))))
      .catch(() => setSnippets([]))
  }, [paletteOpen])

  // 有会话时每 3s 刷新停靠栏预览文本
  useEffect(() => {
    if (sessions.length === 0) return
    const t = setInterval(() => setPreviewTick(v => v + 1), 3000)
    return () => clearInterval(t)
  }, [sessions.length])

  // 连接管理浮层：出现新连接时自动关闭并让位给新窗口
  useEffect(() => {
    const prev = prevConnCountRef.current
    prevConnCountRef.current = connectedConnections.length
    if (manageOpen && connectedConnections.length > prev) {
      setManageOpen(false)
    }
  }, [connectedConnections.length, manageOpen])

  const openManage = useCallback(() => setManageOpen(true), [])

  // ⌘K 命令面板 / ⌘F 搜索（布局切换统一在设置中进行）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault()
        setPaletteOpen(v => !v)
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (focusKey) setActiveSearchSessionKey(focusKey)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusKey, setActiveSearchSessionKey])

  // 终端搜索浮条（作用于搜索状态指向的窗口）
  const searchTargetKey = activeSearchSessionKey && sessions.some(s => s.key === activeSearchSessionKey)
    ? activeSearchSessionKey
    : null
  const doSearch = useCallback((dir: 'next' | 'prev', textOverride?: string) => {
    const text = textOverride ?? searchText
    if (!searchTargetKey || !text) return
    const addon = searchAddons.current[searchTargetKey]
    if (!addon) return
    const opts = {
      regex: searchMode === 'regex',
      wholeWord: searchMode === 'wholeWord',
      caseSensitive: false,
      incremental: true,
    }
    try {
      if (dir === 'next') addon.findNext(text, opts)
      else addon.findPrevious(text, opts)
    } catch {
      // 非法正则等输入错误忽略
    }
  }, [searchTargetKey, searchText, searchMode, searchAddons])

  const closeSearch = useCallback(() => {
    setActiveSearchSessionKey(null)
    setSearchText('')
    terminalInstances.current[searchTargetKey || '']?.focus()
  }, [setActiveSearchSessionKey, setSearchText, terminalInstances, searchTargetKey])

  // 命令面板：焦点连接的历史命令
  const historyCommands = useMemo(() => {
    if (!focusConnId) return []
    const cache = useHistoryStore.getState().caches.get(focusConnId)
    if (!cache) return []
    return [...cache].sort((a, b) => b.count - a.count).slice(0, 10).map(c => ({ text: c.text, count: c.count }))
  }, [focusConnId, paletteOpen])

  const runInFocus = useCallback((data: string) => {
    if (focusKey) enqueueWrite(focusKey, data)
  }, [focusKey, enqueueWrite])

  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

  return (
    <div className="ck-root" style={themeVars}>
      {/* 顶条：兼作窗口拖拽区（驾驶舱模式不渲染独立标题栏），
          macOS 红绿灯悬浮在左上角，左侧留出安全宽度 */}
      <div className="ck-top" data-tauri-drag-region style={isMac ? { paddingLeft: 78 } : undefined}>
        <div className="ck-logo">&gt;_</div>
        <div className="ck-crumb">
          <span className={`ck-dot${focusedConn ? (focusedConn.reconnecting ? ' warn' : '') : ' off'}`} />
          <b>{focusedConn?.connection.name ?? '未连接'}</b>
          {focusedCwd && <span className="cwd">{focusedCwd}</span>}
        </div>
        <button className="ck-cmdbtn" onClick={() => setPaletteOpen(true)}>
          <SearchOutlined style={{ fontSize: 12 }} />
          <span>搜索主机、跳转会话、运行命令…</span>
          <span className="ck-kbd">⌘K</span>
        </button>
        <div className="ck-top-right">
          <button
            className={`ck-icon-btn${focusMode ? ' on' : ''}`}
            title={focusMode ? '退出专注模式' : '专注模式（隐藏主机墙与停靠栏）'}
            onClick={() => setFocusMode(v => !v)}
          >
            {focusMode ? <ShrinkOutlined style={{ fontSize: 14 }} /> : <ExpandOutlined style={{ fontSize: 14 }} />}
          </button>
          <button className="ck-icon-btn" title="连接管理" onClick={openManage}>
            <AppstoreOutlined style={{ fontSize: 14 }} />
          </button>
          <button className="ck-icon-btn" title="设置" onClick={() => setSettingsVisible(true)}>
            <SettingOutlined style={{ fontSize: 14 }} />
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className={`ck-icon-btn${themePopOpen ? ' on' : ''}`}
              title="驾驶舱主题"
              onClick={e => { e.stopPropagation(); setThemePopOpen(v => !v) }}
            >
              <BgColorsOutlined style={{ fontSize: 14 }} />
            </button>
            {themePopOpen && (
              <div className="ck-themepop" onClick={e => e.stopPropagation()}>
                <div className="ck-tp-h">驾驶舱主题</div>
                {COCKPIT_THEME_LIST.map(t => (
                  <button
                    key={t.id}
                    className={`ck-tp-item${t.id === cockpitTheme ? ' on' : ''}`}
                    onClick={() => applyTheme(t.id)}
                  >
                    <span className="sw" style={{ background: t.swatch, boxShadow: `0 0 8px ${t.swatch}80` }} />
                    <span>
                      <span className="n">{t.name}{t.id === 'force' && <b>默认</b>}</span>
                      <span className="d">{t.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 画布（窄画布时主机墙自动收窄，dock/预览卡经 --ck-wall-w 联动） */}
      <div className={`ck-canvas${narrowWall ? ' ck-narrow' : ''}${wallCollapsed ? ' ck-wall-folded' : ''}`} ref={canvasRef}>
        {!focusMode && (
          <HostWall
            connectedConnections={connectedConnections}
            allConnections={allConnections}
            onHostClick={handleHostClick}
            onNewSession={onNewSession}
            onAddHost={openManage}
            collapsed={wallCollapsed}
            onToggleCollapse={setWallCollapsed}
            onDetachToNewWindow={onDetachToNewWindow}
          />
        )}

        {sessions.length === 0 && (
          <div className="ck-empty">
            <b>驾驶舱</b>
            <span>点击左侧主机墙的卡片开始连接，每个会话都会变成一个可自由拖动的浮动窗口。</span>
            <span>按 <span className="ck-kbd">⌘K</span> 打开命令面板，任何操作都能搜到。</span>
          </div>
        )}

        {sessions.map(({ conn, sess, key }, i) => {
          const geo = cockpitWindowGeometry[key] || defaultGeometry(i, bounds)
          // 最小化：窗口隐藏（会话与输出保留），从停靠栏点击还原
          if (geo.minimized) return null
          const clamped = clampGeometry(geo, bounds)
          return (
            <FloatingWindow
              key={key}
              sessionKey={key}
              title={conn.connection.name}
              sub={
                `${conn.connection.username}@${conn.connection.host} · ${sess.title}` +
                (currentPaths[conn.connectionId] ? ` · ${currentPaths[conn.connectionId]}` : '')
              }
              focused={key === focusKey}
              // 层级梯子：窗口 ≤300，预览卡 480 / 抽屉 470 / 搜索条 500 / 命令面板 600 / 连接管理 700
              zIndex={key === focusKey ? 300 : 20 + Math.min(i, 260)}
              geometry={clamped}
              disconnected={conn.disconnected}
              reconnecting={conn.reconnecting}
              reconnectAttempt={conn.reconnectAttempt}
              initializing={conn.initializing}
              broadcastEnabled={broadcastEnabled}
              fontFamily={fontFamily}
              fontSize={fontSize}
              terminalRefs={terminalRefs}
              ghostTextElementsRef={ghostTextElementsRef}
              themeColors={currentThemeColors}
              bounds={bounds}
              onFocus={() => { if (key !== focusKey) focusSession(key) }}
              onGeometryCommit={g => commitGeometry(key, g)}
              onMinimize={() => {
                commitGeometry(key, { ...geo, minimized: true, zoomed: false, prev: undefined })
                const next = sessions.find(s2 => s2.key !== key && !cockpitWindowGeometry[s2.key]?.minimized)
                if (next) focusSession(next.key)
              }}
              onClose={() => onCloseSession(conn.connectionId, sess.id)}
              onReconnect={() => onReconnect(conn.connectionId, true)}
              onContextMenu={onSessionContextMenu}
            />
          )
        })}

        {/* 状态 pill */}
        {!focusMode && focusedConn && (
          <div className="ck-pill">
            <span className={`ck-dot${focusedConn.reconnecting ? ' warn' : ''}`} />
            <span>{focusedConn.connection.username}@{focusedConn.connection.host}</span>
            {focusedCwd && <span style={{ color: 'var(--ck-t3)' }}>{focusedCwd}</span>}
            <span style={{ color: 'var(--ck-t3)' }}>{sessions.filter(s => s.conn.connectionId === focusConnId).length} 会话</span>
          </div>
        )}

        {/* 工具抽屉 */}
        {!focusMode && drawer.open && (
          <ToolDrawer
            activeTab={drawer.tab}
            onTabChange={tab => onDrawerChange({ open: true, tab })}
            onClose={() => onDrawerChange({ ...drawer, open: false })}
          >
            {drawerPanels[drawer.tab] ?? <div style={{ padding: 16, color: 'var(--ck-t3, #5E6577)', fontSize: 12 }}>暂无内容</div>}
          </ToolDrawer>
        )}

        {/* 右侧工具栏 */}
        {!focusMode && (
          <nav className="ck-rail">
            {([
              ['files', '文件管理', <FolderOutlined key="i" />],
              ['monitor', '系统监控', <DashboardOutlined key="i" />],
              ['docker', 'Docker', <ContainerOutlined key="i" />],
              ['ports', '端口转发', <ApiOutlined key="i" />],
              ['ai', 'AI 助手', <RobotOutlined key="i" />],
            ] as const).map(([tab, label, icon]) => (
              <button
                key={tab}
                className={`ck-icon-btn${drawer.open && drawer.tab === tab ? ' on' : ''}`}
                title={label}
                onClick={() => openDrawerTab(tab)}
              >
                {icon}
              </button>
            ))}
          </nav>
        )}

        {!focusMode && (
          <SessionDock
            items={dockItems}
            onFocus={key => {
              const geo = cockpitWindowGeometry[key]
              if (geo?.minimized) {
                commitGeometry(key, { ...geo, minimized: false })
              }
              focusSession(key)
            }}
            onClose={sessionId => {
              const item = dockItems.find(d => d.sessionId === sessionId)
              if (item) onCloseSession(item.connectionId, sessionId)
            }}
            onNew={() => (focusConnId ? onNewSession(focusConnId) : openManage())}
          />
        )}

        {/* 终端搜索浮条（作用于搜索状态指向的窗口） */}
        {searchTargetKey && (
          <div className="ck-searchbar">
            <SearchOutlined style={{ color: 'var(--ck-t3)', fontSize: 12 }} />
            <Input
              autoFocus
              size="small"
              variant="borderless"
              placeholder="搜索…"
              value={searchText}
              onChange={e => { setSearchText(e.target.value); requestAnimationFrame(() => doSearch('next', e.target.value)) }}
              onPressEnter={() => doSearch('next')}
              onKeyDown={e => {
                if (e.key === 'Escape') closeSearch()
                if (e.key === 'Enter' && e.shiftKey) doSearch('prev')
              }}
              style={{ width: 170, color: 'var(--ck-t1)' }}
            />
            <button className={`ck-smode${searchMode === 'normal' ? ' on' : ''}`} onClick={() => setSearchMode('normal')}>文本</button>
            <button className={`ck-smode${searchMode === 'regex' ? ' on' : ''}`} onClick={() => setSearchMode('regex')}>正则</button>
            <button className={`ck-smode${searchMode === 'wholeWord' ? ' on' : ''}`} onClick={() => setSearchMode('wholeWord')}>整词</button>
            <button className="ck-snav" title="上一个（Shift+Enter）" onClick={() => doSearch('prev')}><UpOutlined style={{ fontSize: 10 }} /></button>
            <button className="ck-snav" title="下一个（Enter）" onClick={() => doSearch('next')}><DownOutlined style={{ fontSize: 10 }} /></button>
            <button className="ck-snav" title="关闭（Esc）" onClick={closeSearch}><CloseOutlined style={{ fontSize: 10 }} /></button>
          </div>
        )}
      </div>

      {/* 连接管理浮层（驾驶舱原生，不回经典页面布局） */}
      {manageOpen && (
        <ConnectionsOverlay
          connectedConnections={connectedConnections}
          onConnect={handleHostClick}
          onClose={() => setManageOpen(false)}
        />
      )}

      {/* ⌘K 命令面板 */}
      <CommandPalette
        visible={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        allConnections={allConnections}
        connectedConnections={connectedConnections}
        onJumpSession={focusSession}
        onConnectHost={onHostClick}
        onRunCommand={runInFocus}
        historyCommands={historyCommands}
        onToggleDrawer={t => openDrawerTab(t)}
        onOpenConnections={openManage}
        broadcastEnabled={broadcastEnabled}
        onToggleBroadcast={toggleBroadcast}
        snippets={snippets}
        onDetachToNewWindow={onDetachToNewWindow}
      />
    </div>
  )
}

function defaultGeometry(index: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }): CockpitWindowGeometry {
  const n = index % 5
  // 默认尺寸按可用区自适应：约 62%，上限 620x400，下限 360x240（小窗口也能完整放下）
  const availW = bounds.maxX - bounds.minX
  const availH = bounds.maxY - bounds.minY
  const w = Math.max(360, Math.min(620, Math.round(availW * 0.62)))
  const h = Math.max(240, Math.min(400, Math.round(availH * 0.62)))
  return {
    x: bounds.minX + 16 + n * 40,
    y: bounds.minY + 12 + n * 34,
    w,
    h,
  }
}

function clampGeometry(geo: CockpitWindowGeometry, bounds: { minX: number; minY: number; maxX: number; maxY: number }): CockpitWindowGeometry {
  // 尺寸也要钳制：换小屏幕后历史几何可能超出当前可用区
  const w = Math.max(320, Math.min(geo.w, bounds.maxX - bounds.minX))
  const h = Math.max(180, Math.min(geo.h, bounds.maxY - bounds.minY))
  const x = Math.max(bounds.minX, Math.min(geo.x, Math.max(bounds.minX, bounds.maxX - w)))
  const y = Math.max(bounds.minY, Math.min(geo.y, Math.max(bounds.minY, bounds.maxY - h)))
  if (x === geo.x && y === geo.y && w === geo.w && h === geo.h) return geo
  return { ...geo, x, y, w, h }
}
