import { CopyOutlined, SnippetsOutlined, CheckCircleOutlined, SearchOutlined } from '@ant-design/icons'

interface ContextMenuProps {
  x: number
  y: number
  visible: boolean
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onFind: () => void
}

export function ContextMenu({
  x,
  y,
  visible,
  onCopy,
  onPaste,
  onSelectAll,
  onFind,
}: ContextMenuProps) {
  if (!visible) return null

  return (
    <div
      id="terminal-context-menu"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        background: 'var(--color-bg-elevated)',
        borderRadius: 4,
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        minWidth: 120,
        fontSize: 13,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem icon={<CopyOutlined />} label="复制" onClick={onCopy} />
      <MenuItem icon={<SnippetsOutlined />} label="粘贴" onClick={onPaste} />
      <MenuItem icon={<CheckCircleOutlined />} label="全选" onClick={onSelectAll} />
      <div style={{ height: 1, background: 'var(--color-border)', margin: '3px 0' }} />
      <MenuItem icon={<SearchOutlined />} label="查找" onClick={onFind} />
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <div
      style={{
        padding: '6px 12px',
        cursor: 'pointer',
        color: 'var(--color-text)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-spotlight)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon} {label}
    </div>
  )
}