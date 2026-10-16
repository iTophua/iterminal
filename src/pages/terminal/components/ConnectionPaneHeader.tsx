import { Button, Tooltip } from 'antd'
import { CloseOutlined, MinusCircleOutlined } from '@ant-design/icons'

/**
 * 连接分屏视图中每个连接面板顶部的识别条：
 * 显示连接名/主机，点击可激活该连接；右侧提供「从分屏移除」「关闭连接」
 */
export function ConnectionPaneHeader({
  connectionName,
  username,
  host,
  isActive,
  disconnected,
  reconnecting,
  onActivate,
  onRemoveFromSplit,
  onCloseConnection,
}: {
  connectionName: string
  username: string
  host: string
  isActive: boolean
  disconnected?: boolean
  reconnecting?: boolean
  onActivate: () => void
  onRemoveFromSplit: () => void
  onCloseConnection: () => void
}) {
  return (
    <div
      style={{
        height: 26,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px 0 10px',
        background: isActive ? 'var(--color-bg-spotlight)' : 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onMouseDown={onActivate}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: disconnected
            ? 'var(--color-error)'
            : reconnecting
              ? 'var(--color-warning)'
              : 'var(--color-primary)',
        }}
      />
      <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
        {connectionName || `${username}@${host}`}
      </span>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {username}@{host}
      </span>
      {reconnecting && <span style={{ fontSize: 11, color: 'var(--color-warning)' }}>重连中...</span>}
      <span style={{ flex: 1 }} />
      <Tooltip title="从分屏移除（保留连接）">
        <Button
          type="text"
          size="small"
          icon={<MinusCircleOutlined style={{ fontSize: 11 }} />}
          onClick={(e) => { e.stopPropagation(); onRemoveFromSplit() }}
          style={{ color: 'var(--color-text-tertiary)' }}
        />
      </Tooltip>
      <Tooltip title="关闭连接">
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined style={{ fontSize: 11 }} />}
          onClick={(e) => { e.stopPropagation(); onCloseConnection() }}
          style={{ color: 'var(--color-text-tertiary)' }}
        />
      </Tooltip>
    </div>
  )
}
