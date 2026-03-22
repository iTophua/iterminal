import { CloseOutlined, HolderOutlined } from '@ant-design/icons'

interface DraggableSessionTabProps {
  sessionId: string
  connectionId: string
  title: string
  onClose: () => void
  onDragStart: (sessionId: string, connectionId: string, title: string) => void
}

/**
 * 可拖拽的会话标签组件
 * 用于会话在分屏间的拖拽移动
 */
export function DraggableSessionTab({
  sessionId,
  connectionId,
  title,
  onClose,
  onDragStart,
}: DraggableSessionTabProps) {
  return (
    <span
      style={{
        fontSize: 12,
        cursor: 'grab',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0,
        padding: '2px 0',
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('.session-tab-close')) return
        e.stopPropagation()
        e.preventDefault()
        onDragStart(sessionId, connectionId, title)
      }}
    >
      <HolderOutlined style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginRight: 2 }} />
      <span style={{ lineHeight: '16px' }}>{title}</span>
      <CloseOutlined
        className="session-tab-close"
        style={{ marginLeft: 4, fontSize: 9, cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
    </span>
  )
}
