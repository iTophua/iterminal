import React from 'react'
import { CloseOutlined, HolderOutlined } from '@ant-design/icons'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Connection } from '../../../stores/terminalStore'

interface SortableTabProps {
  id: string
  label: React.ReactNode
  connectionName?: string
}

/**
 * 可拖拽排序的标签组件
 * 用于连接标签的拖拽排序
 */
export function SortableTab({ id, label, connectionName }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    lineHeight: 1,
  }

  return (
    <span
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-connection-tab-id={id}
      data-connection-name={connectionName}
      className="sortable-tab-wrapper"
    >
      <HolderOutlined className="sortable-tab-handle" style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginRight: 2, opacity: 0.6, transition: 'opacity 0.2s' }} />
      {label}
    </span>
  )
}

interface ConnectionTabProps {
  connectionId: string
  connection: Connection
  onClose: (connectionId: string) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function ConnectionTab({
  connectionId,
  connection,
  onClose,
  onDragStart,
  onDragEnd,
}: ConnectionTabProps) {
  const handlePointerDown: React.PointerEventHandler = (e) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.connection-tab-close')) return

    onDragStart?.()
  }

  const handlePointerUp: React.PointerEventHandler = () => {
    onDragEnd?.()
  }

  return (
    <span
      style={{
        color: connection.group === '生产环境' ? 'var(--color-error)' : 'var(--color-text)',
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {connection.username}@{connection.host}
      <CloseOutlined
        className="connection-tab-close"
        style={{ marginLeft: 4, fontSize: 9 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose(connectionId)
        }}
      />
    </span>
  )
}
