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
    // 拖拽时取消 transition，避免与 dnd-kit 内部动画冲突导致内容空白
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    lineHeight: 1,
    position: 'relative',
    // 拖拽时提升层级，避免被其他 tab 遮挡导致内容空白
    zIndex: isDragging ? 1 : undefined,
    // 确保 transform 基准正确，避免文字被裁剪
    transformOrigin: 'center center',
    // 强制创建 GPU 合成层，避免被父元素 overflow:hidden 裁剪
    willChange: isDragging ? 'transform' : undefined,
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
