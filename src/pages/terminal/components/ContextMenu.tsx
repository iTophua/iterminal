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
        borderRadius: 6,
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        minWidth: 160,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem icon={<CopyOutlined />} label="复制" onClick={onCopy} />
      <MenuItem icon={<SnippetsOutlined />} label="粘贴" onClick={onPaste} />
      <MenuItem icon={<CheckCircleOutlined />} label="全选" onClick={onSelectAll} />
      <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
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
        padding: '8px 16px',
        cursor: 'pointer',
        color: 'var(--color-text)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon} {label}
    </div>
  )
}