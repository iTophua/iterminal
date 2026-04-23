import { CloseOutlined, WarningOutlined } from '@ant-design/icons'

interface DraggableSessionTabProps {
  sessionId: string
  connectionId: string
  title: string
  onClose: () => void
  onDragStart: (sessionId: string, connectionId: string, title: string) => void
  isDisconnected?: boolean
}

export function DraggableSessionTab({
  sessionId,
  connectionId,
  title,
  onClose,
  onDragStart,
  isDisconnected = false,
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
        userSelect: 'none',
        position: 'relative',
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
      {isDisconnected && (
        <WarningOutlined
          style={{
            color: 'var(--color-warning)',
            fontSize: 11,
            marginRight: 3,
            animation: 'tabDisconnectPulse 1.5s ease-in-out infinite',
          }}
        />
      )}
      <span
        style={{
          lineHeight: '16px',
          color: isDisconnected ? 'var(--color-warning)' : undefined,
        }}
      >
        {title}
      </span>
      <CloseOutlined
        className="session-tab-close"
        style={{
          marginLeft: 10,
          fontSize: 10,
          cursor: 'pointer',
          opacity: 0.4,
          transition: 'opacity 0.2s ease',
          color: isDisconnected ? 'var(--color-warning)' : undefined,
        }}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      />
    </span>
  )
}
