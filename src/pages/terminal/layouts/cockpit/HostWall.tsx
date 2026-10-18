import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DoubleLeftOutlined, DoubleRightOutlined, PlusOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectedConnection, Connection, SplitPane } from '../../../../stores/terminalStore'

interface HostWallProps {
  connectedConnections: ConnectedConnection[]
  allConnections: Connection[]
  /** 点击主机卡：已连接 → 聚焦其窗口；未连接 → 发起连接 */
  onHostClick: (conn: Connection) => void
  /** 预览卡「新会话」 */
  onNewSession: (connectionId: string) => void
  onAddHost: () => void
  /** 折叠为图标条 */
  collapsed: boolean
  onToggleCollapse: (collapsed: boolean) => void
  /** 拖出为独立窗口 */
  onDetachToNewWindow: (connectionId: string) => void
}

interface MonitorSnapshot {
  cpuUsage: number
  memUsage: number
  memText: string
}

function countSessions(pane: SplitPane): number {
  let n = pane.sessions.length
  for (const child of pane.children ?? []) n += countSessions(child)
  return n
}

/**
 * 驾驶舱左侧主机墙：全部已保存连接按分组展示；
 * 悬停已连接主机显示实时指标预览卡（CPU/内存）。
 */
export function HostWall({ connectedConnections, allConnections, onHostClick, onNewSession, onAddHost, collapsed, onToggleCollapse, onDetachToNewWindow }: HostWallProps) {
  const [groupFilter, setGroupFilter] = useState<string>('全部')
  const [preview, setPreview] = useState<{ connId: string; top: number; left: number } | null>(null)
  const [monitor, setMonitor] = useState<Record<string, MonitorSnapshot>>({})
  const [latency, setLatency] = useState<Record<string, number>>({})
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monitorTs = useRef<Record<string, number>>({})

  const groups = useMemo(() => {
    const map = new Map<string, Connection[]>()
    for (const conn of allConnections) {
      const g = conn.group || '默认'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(conn)
    }
    return Array.from(map.entries()).map(([name, conns]) => ({ name, conns }))
  }, [allConnections])

  const groupNames = useMemo(() => ['全部', ...groups.map(g => g.name)], [groups])
  const visibleGroups = useMemo(
    () => (groupFilter === '全部' ? groups : groups.filter(g => g.name === groupFilter)),
    [groups, groupFilter]
  )

  const sessionCount = (connId: string) => {
    const c = connectedConnections.find(x => x.connectionId === connId)
    return c ? countSessions(c.rootPane) : 0
  }

  // 悬停已连接主机时拉一次实时指标
  const showPreview = useCallback(async (connId: string, cardEl: HTMLElement) => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
    // 预览卡挂在画布上（wall 有 overflow:auto 会裁剪），左/顶都换算成画布相对坐标内联定位
    const canvas = cardEl.closest('.ck-canvas') as HTMLElement | null
    const canvasRect = canvas?.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()
    const wallRight = cardEl.closest('.ck-wall')?.getBoundingClientRect().right ?? 0
    let top = canvasRect ? cardRect.top - canvasRect.top + 26 : cardEl.offsetTop + 26
    if (canvas) top = Math.min(top, Math.max(12, canvas.clientHeight - 236))
    const left = canvasRect ? wallRight - canvasRect.left + 10 : 300
    setPreview({ connId, top: Math.max(12, top), left })
    const connected = connectedConnections.some(c => c.connectionId === connId)
    if (!connected) return
    const cached = monitorTs.current[connId]
    if (cached && Date.now() - cached < 10_000) return
    monitorTs.current[connId] = Date.now()
    // 并行测一次连接延迟（TCP+SSH 握手耗时，悬停时单次）
    const conn = allConnections.find(c => c.id === connId)
    if (conn) {
      const t0 = performance.now()
      invoke<boolean>('test_connection', {
        connection: {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password || null,
          key_file: conn.keyFile || null,
        }
      }).then(ok => {
        if (ok) setLatency(prev => ({ ...prev, [connId]: Math.round(performance.now() - t0) }))
      }).catch(() => {})
    }
    try {
      const result = await invoke<any>('get_system_monitor', { id: connId })
      const mem = result?.memory
      const memUsedMb = mem ? (mem.total_mb - mem.available_mb) : 0
      setMonitor(prev => ({
        ...prev,
        [connId]: {
          cpuUsage: Math.round(result?.cpu?.usage ?? 0),
          memUsage: mem && mem.total_mb ? Math.round((memUsedMb / mem.total_mb) * 100) : 0,
          memText: mem ? `${(memUsedMb / 1024).toFixed(1)}G / ${(mem.total_mb / 1024).toFixed(1)}G` : '—',
        },
      }))
    } catch {
      // 拉取失败保持占位（不显示指标行）
    }
  }, [connectedConnections, allConnections])

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => setPreview(null), 160)
  }, [])

  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [])

  const previewConn = preview ? allConnections.find(c => c.id === preview.connId) : null
  const previewConnected = preview ? connectedConnections.some(c => c.connectionId === preview.connId) : false
  const previewMon = preview ? monitor[preview.connId] : undefined

  // 折叠态：48px 图标条，保留连接/聚焦入口与悬停预览。
  // 预览卡必须渲染在 aside 外（wall 是 overflow:auto 的绝对定位容器，放里面会被钉在左缘并裁剪）
  if (collapsed) {
    return (
      <>
      <aside className="ck-wall ck-wall-collapsed" aria-label="主机墙（已折叠）">
        <button className="ck-wall-fold" title="展开主机墙" onClick={() => onToggleCollapse(false)}>
          <DoubleRightOutlined style={{ fontSize: 12 }} />
        </button>
        <div className="ck-wall-icons">
          {allConnections.slice(0, 24).map(conn => {
            const connected = connectedConnections.some(c => c.connectionId === conn.id)
            return (
              <button
                key={conn.id}
                className={`ck-wall-ico${connected ? ' on' : ''}`}
                title={`${conn.name} · ${conn.username}@${conn.host}${connected ? '' : ' · 点击连接'}`}
                onClick={() => onHostClick(conn)}
                onMouseEnter={e => showPreview(conn.id, e.currentTarget)}
                onMouseLeave={scheduleHide}
              >
                {conn.name.slice(0, 1).toUpperCase()}
              </button>
            )
          })}
          {allConnections.length > 24 && (
            <span className="ck-wall-ico-more" title={`还有 ${allConnections.length - 24} 台，展开查看`}>…</span>
          )}
        </div>
        <button className="ck-wall-fold bottom" title="新建连接" onClick={onAddHost}>
          <PlusOutlined style={{ fontSize: 12 }} />
        </button>
      </aside>
      {preview && previewConn && <PreviewCard />}
      </>
    )
  }

  return (
    <>
    <aside className="ck-wall">
      <h3>
        主机
        <span style={{ display: 'inline-flex', gap: 2 }}>
          <button title="新建连接" onClick={onAddHost}><PlusOutlined style={{ fontSize: 12 }} /></button>
          <button title="折叠主机墙" onClick={() => onToggleCollapse(true)}><DoubleLeftOutlined style={{ fontSize: 12 }} /></button>
        </span>
      </h3>
      {groupNames.length > 1 && (
        <div className="ck-gpills">
          {groupNames.slice(0, 6).map(g => (
            <button
              key={g}
              className={`ck-gp${g === groupFilter ? ' on' : ''}`}
              onClick={() => setGroupFilter(g)}
            >
              {g === '全部'
                ? `全部 ${allConnections.length}`
                : `${g} ${groups.find(x => x.name === g)?.conns.length ?? 0}`}
            </button>
          ))}
        </div>
      )}
      <div className="ck-hgrid">
        {visibleGroups.map(({ conns }) =>
          conns.map(conn => {
            const connected = connectedConnections.find(x => x.connectionId === conn.id)
            const sc = sessionCount(conn.id)
            return (
              <button
                key={conn.id}
                className={`ck-hcard${connected ? ' on' : ''}`}
                onClick={() => onHostClick(conn)}
                onMouseEnter={e => showPreview(conn.id, e.currentTarget)}
                onMouseLeave={scheduleHide}
                title={`${conn.name} · ${conn.username}@${conn.host}${connected ? ` · ${sc} 个会话` : ' · 点击连接'}`}
              >
                <span className={`ck-dot${connected ? '' : ' off'}`} />
                <div className="nm">{conn.name}</div>
                <div className="ip">{conn.username}@{conn.host}</div>
                {sc > 0 && <span className="ck-hcard-sc">{sc} 会话</span>}
              </button>
            )
          })
        )}
      </div>
      {allConnections.length === 0 && (
        <div className="ck-empty-hint">
          还没有保存的连接。点击上方 ＋ 新建，或从连接管理页导入；连接后会以浮动窗口出现在右侧画布。
        </div>
      )}
    </aside>

    {/* 悬停预览卡（挂在画布上，避免被 wall 的 overflow 裁剪） */}
    {preview && previewConn && <PreviewCard />}
    </>
  )

  function PreviewCard() {
    const conn = previewConn!
    const mon = previewMon
    return (
        <div
          className="ck-hpreview"
          style={{ top: preview!.top, left: preview!.left }}
          onMouseEnter={() => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null } }}
          onMouseLeave={() => setPreview(null)}
          role="tooltip"
        >
          <h5>
            <span className={`ck-dot${previewConnected ? '' : ' off'}`} />
            {conn.name}
          </h5>
          <div className="ip">{conn.username}@{conn.host}</div>
          {previewConnected ? (
            mon ? (
              <>
                <div className="mrow"><span>CPU</span><b>{mon.cpuUsage}%</b></div>
                <div className="mbar"><i style={{ width: `${mon.cpuUsage}%`, background: 'var(--ck-accent)' }} /></div>
                <div className="mrow"><span>内存</span><b>{mon.memUsage}%</b></div>
                <div className="mbar"><i style={{ width: `${mon.memUsage}%`, background: '#F5B950' }} /></div>
                <div className="msub">
                  {mon.memText}{latency[preview!.connId] != null ? ` · 延迟 ${latency[preview!.connId]}ms` : ''}
                </div>
              </>
            ) : (
              <div className="msub">读取指标中…</div>
            )
          ) : (
            <div className="msub">未连接 · 点击卡片即可连接</div>
          )}
          <div className="acts">
            {previewConnected ? (
              <>
                <button className="pri" onClick={() => { onNewSession(conn.id); setPreview(null) }}>新会话</button>
                <button onClick={() => { onHostClick(conn); setPreview(null) }}>聚焦</button>
                <button title="把这个连接移到独立窗口" onClick={() => { onDetachToNewWindow(conn.id); setPreview(null) }}>⧉</button>
              </>
            ) : (
              <button className="pri" style={{ width: '100%' }} onClick={() => { onHostClick(conn); setPreview(null) }}>连接</button>
            )}
          </div>
        </div>
    )
  }
}
