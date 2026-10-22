import React, { useCallback, useRef } from 'react'
import { CloseOutlined, ExpandOutlined, MinusOutlined, ShrinkOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import type { CockpitWindowGeometry } from '../../../../stores/terminalStore'
import { GhostTextOverlay } from '../../../../components/GhostTextOverlay'
import type { TerminalThemeColors } from '../../../../types/theme'

export interface FloatingWindowProps {
  sessionKey: string
  /** 窗口标题：连接名 */
  title: string
  /** 副标题：user@host · cwd */
  sub: string
  focused: boolean
  zIndex: number
  geometry: CockpitWindowGeometry
  disconnected?: boolean
  reconnecting?: boolean
  reconnectAttempt?: number
  initializing?: boolean
  broadcastEnabled?: boolean
  fontFamily: string
  fontSize: number
  terminalRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  ghostTextElementsRef: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  themeColors: TerminalThemeColors
  /** 画布可视区域（用于拖拽边界钳制与最大化矩形） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  onFocus: () => void
  onGeometryCommit: (geo: CockpitWindowGeometry) => void
  onMinimize: () => void
  onClose: () => void
  onReconnect: () => void
  onContextMenu: (e: React.MouseEvent, sessionKey: string) => void
}

/**
 * 驾驶舱浮动终端窗口。
 * 拖拽/缩放期间直接改 DOM 样式（不触发 React 渲染），松手时一次性提交几何到 store。
 */
export const FloatingWindow = React.memo(function FloatingWindow({
  sessionKey,
  title,
  sub,
  focused,
  zIndex,
  geometry,
  disconnected,
  reconnecting,
  reconnectAttempt,
  initializing,
  broadcastEnabled,
  fontFamily,
  fontSize,
  terminalRefs,
  ghostTextElementsRef,
  themeColors,
  bounds,
  onFocus,
  onGeometryCommit,
  onMinimize,
  onClose,
  onReconnect,
  onContextMenu,
}: FloatingWindowProps) {
  const winRef = useRef<HTMLDivElement>(null)

  const clamp = useCallback((x: number, y: number, w: number, h: number) => {
    const cx = Math.max(bounds.minX, Math.min(x, Math.max(bounds.minX, bounds.maxX - w)))
    const cy = Math.max(bounds.minY, Math.min(y, Math.max(bounds.minY, bounds.maxY - h)))
    return { x: cx, y: cy }
  }, [bounds])

  const beginDrag = useCallback((mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = winRef.current
    if (!el) return

    const start = {
      sx: e.clientX,
      sy: e.clientY,
      ox: geometry.x,
      oy: geometry.y,
      ow: geometry.w,
      oh: geometry.h,
    }
    // 最新几何；拖拽过程中只更新它和 DOM，不触发 React 渲染
    let latest = { x: start.ox, y: start.oy, w: start.ow, h: start.oh }

    const onMove = (ev: PointerEvent) => {
      if (mode === 'move') {
        const c = clamp(start.ox + ev.clientX - start.sx, start.oy + ev.clientY - start.sy, start.ow, start.oh)
        latest = { x: c.x, y: c.y, w: start.ow, h: start.oh }
      } else {
        latest = {
          x: start.ox,
          y: start.oy,
          w: Math.max(320, start.ow + ev.clientX - start.sx),
          h: Math.max(180, start.oh + ev.clientY - start.sy),
        }
      }
      el.style.left = `${latest.x}px`
      el.style.top = `${latest.y}px`
      el.style.width = `${latest.w}px`
      el.style.height = `${latest.h}px`
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      // 未发生移动（如双击最大化触发的 down/up 序列）不提交，避免覆盖 zoomed/prev
      const moved = latest.x !== start.ox || latest.y !== start.oy || latest.w !== start.ow || latest.h !== start.oh
      if (!moved) return
      // 手动拖拽/缩放后取消最大化状态
      onGeometryCommit({ x: latest.x, y: latest.y, w: latest.w, h: latest.h, zoomed: false, prev: undefined })
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [geometry, clamp, onGeometryCommit])

  const handleToggleZoom = useCallback(() => {
    if (geometry.zoomed) {
      onGeometryCommit({
        ...(geometry.prev || { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h }),
        zoomed: false,
        prev: undefined,
      })
    } else {
      onGeometryCommit({
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX,
        h: bounds.maxY - bounds.minY,
        zoomed: true,
        prev: { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h },
      })
    }
    onFocus()
  }, [geometry, bounds, onGeometryCommit, onFocus])

  return (
    <div
      ref={winRef}
      className={`ck-win${focused ? ' focus' : ''}`}
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h, zIndex }}
      onPointerDown={onFocus}
    >
      <div className="ck-win-h" onPointerDown={beginDrag('move')} onDoubleClick={handleToggleZoom}>
        <span className="ck-fdot" />
        <span className="t">{title}</span>
        <span className="meta">{sub}</span>
        {broadcastEnabled && (
          <span className="ck-bcast" title="输入广播已开启：此窗口输入会同步到其它终端">⚡</span>
        )}
        <span className="ops">
          <button title="最小化到停靠栏" onClick={onMinimize}><MinusOutlined style={{ fontSize: 11 }} /></button>
          <button title={geometry.zoomed ? '还原（双击标题栏）' : '最大化（双击标题栏）'} onClick={handleToggleZoom}>
            {geometry.zoomed ? <ShrinkOutlined style={{ fontSize: 11 }} /> : <ExpandOutlined style={{ fontSize: 11 }} />}
          </button>
          <button title="关闭会话" onClick={onClose}><CloseOutlined style={{ fontSize: 11 }} /></button>
        </span>
      </div>
      <div className="ck-win-body">
        <div
          className="ck-term"
          onContextMenu={e => onContextMenu(e, sessionKey)}
        >
          <div ref={el => { terminalRefs.current[sessionKey] = el }} className="ck-term-inner" />
        </div>
        <GhostTextOverlay
          sessionKey={sessionKey}
          fontFamily={fontFamily}
          fontSize={fontSize}
          themeColors={themeColors}
          ref={el => { ghostTextElementsRef.current[sessionKey] = el }}
        />
        {disconnected && (
          <div className="ck-win-banner">
            <span>
              ⚠️ 连接已断开 {reconnecting ? `(重连中... 尝试 ${reconnectAttempt || 1})` : '— 按回车重连'}
            </span>
            {!reconnecting && <button onClick={onReconnect}>立即重连</button>}
          </div>
        )}
        {initializing && (
          <div className="ck-win-init">
            <Spin size="small" />
            <span>正在初始化终端...</span>
          </div>
        )}
      </div>
      <div className="ck-rsz" onPointerDown={beginDrag('resize')} />
    </div>
  )
})
