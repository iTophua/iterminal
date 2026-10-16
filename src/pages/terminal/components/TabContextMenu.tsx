import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TabContextMenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}

export type TabMenuEntry = TabContextMenuItem | { separator: true }

function isSeparator(entry: TabMenuEntry): entry is { separator: true } {
  return 'separator' in entry
}

/**
 * 连接 tab / 会话 tab 的右键菜单
 * 通用菜单容器：定位、越界回弹、点击外部/滚轮/Escape 关闭
 */
export function TabContextMenu({
  x,
  y,
  visible,
  items,
  onClose,
}: {
  x: number
  y: number
  visible: boolean
  items: TabMenuEntry[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    if (!visible) return
    let nextX = x
    let nextY = y
    const el = menuRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const padding = 8
      if (nextX + rect.width + padding > window.innerWidth) {
        nextX = Math.max(padding, window.innerWidth - rect.width - padding)
      }
      if (nextY + rect.height + padding > window.innerHeight) {
        nextY = Math.max(padding, window.innerHeight - rect.height - padding)
      }
    }
    setPos({ x: nextX, y: nextY })
  }, [visible, x, y, items])

  useEffect(() => {
    if (!visible) return
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleWheel = () => onClose()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 捕获阶段监听，先于其它元素的 mousedown 处理（如终端选中）
    document.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('wheel', handleWheel, { passive: true })
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('wheel', handleWheel, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div
      ref={menuRef}
      id="tab-context-menu"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 1100,
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        minWidth: 160,
        fontSize: 13,
        padding: '3px 0',
        userSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, index) => {
        if (isSeparator(entry)) {
          return <div key={`sep-${index}`} style={{ height: 1, background: 'var(--color-border)', margin: '3px 0' }} />
        }
        return (
          <div
            key={entry.key}
            style={{
              padding: '5px 12px',
              cursor: entry.disabled ? 'default' : 'pointer',
              color: entry.disabled
                ? 'var(--color-text-quaternary)'
                : entry.danger
                  ? 'var(--color-error)'
                  : 'var(--color-text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: entry.disabled ? 0.5 : 1,
            }}
            onClick={() => {
              if (entry.disabled) return
              entry.onClick?.()
              onClose()
            }}
            onMouseEnter={(e) => {
              if (!entry.disabled) e.currentTarget.style.background = 'var(--color-bg-spotlight)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {entry.icon ? <span style={{ fontSize: 12, display: 'inline-flex', width: 14 }}>{entry.icon}</span> : null}
            <span>{entry.label}</span>
          </div>
        )
      })}
    </div>
  )
}
