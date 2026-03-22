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
        boxShadow: 'inset 0 0 40px rgba(0, 185, 107, 0.4)',
        background: 'rgba(0, 185, 107, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--color-primary)',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0, 185, 107, 0.4)',
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
