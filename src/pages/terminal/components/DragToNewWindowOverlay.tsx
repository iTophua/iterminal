import React from 'react'
import { createPortal } from 'react-dom'

interface DragToNewWindowOverlayProps {
  visible: boolean
  text?: string
  icon?: React.ReactNode
}

/**
 * 拖拽到边缘创建新窗口的视觉提示组件
 */
export function DragToNewWindowOverlay({
  visible,
  text = '↗ 释放以在新窗口打开',
  icon,
}: DragToNewWindowOverlayProps) {
  if (!visible) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        border: '4px solid var(--color-primary)',
        pointerEvents: 'none',
        zIndex: 9999,
        boxShadow: 'inset 0 0 40px color-mix(in srgb, var(--color-primary) 40%, transparent)',
        background: 'color-mix(in srgb, var(--color-primary) 5%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--color-primary)',
          color: 'var(--color-bg-base)',
          padding: '12px 24px',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 4px 12px color-mix(in srgb, var(--color-primary) 40%, transparent)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {icon}
        {text}
      </div>
    </div>,
    document.body
  )
}
