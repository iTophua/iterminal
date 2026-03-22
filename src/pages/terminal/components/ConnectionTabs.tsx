import { Tabs } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useTerminalStore } from '../../../stores/terminalStore'
import { ConnectionTab, SortableTab } from './ConnectionTab'
import type { DisconnectedConnection } from '../../../stores/terminalStore'

interface DisconnectedConnectionTabProps {
  disconnectedConnection: DisconnectedConnection
  onClose: (connectionId: string) => void
  onReconnect: (disconnectedConnection: DisconnectedConnection) => void
}

/**
 * 已断开连接的标签内容组件
 */
export function DisconnectedConnectionTab({
  disconnectedConnection,
  onClose,
  onReconnect,
}: DisconnectedConnectionTabProps) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'var(--color-bg-container)',
      }}
    >
      <span style={{ fontSize: 48, color: 'var(--color-error)' }}>×</span>
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>连接已断开</p>
      <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>
        {disconnectedConnection.reason === 'write_failed' && '写入失败，可能是网络中断'}
        {disconnectedConnection.reason === 'channel_closed' && 'SSH Channel 被关闭'}
        {disconnectedConnection.reason === 'server_close' && '服务器主动关闭连接'}
        {disconnectedConnection.reason === 'unknown' && '原因未知'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onReconnect(disconnectedConnection)}
          style={{
            padding: '6px 16px',
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          重新连接
        </button>
        <button
          onClick={() => onClose(disconnectedConnection.connectionId)}
          style={{
            padding: '6px 16px',
            background: 'transparent',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          关闭
        </button>
      </div>
    </div>
  )
}

interface ConnectionTabsProps {
  activeConnectionId: string | null
  onTabChange: (connectionId: string) => void
  onCloseConnection: (connectionId: string) => void
  onReconnectDisconnected: (disconnectedConnection: DisconnectedConnection) => void
  onCloseDisconnected: (connectionId: string) => void
}

export function ConnectionTabs({
  activeConnectionId,
  onTabChange,
  onCloseConnection,
  onReconnectDisconnected,
  onCloseDisconnected,
}: ConnectionTabsProps) {
  const connectedConnections = useTerminalStore((state) => state.connectedConnections)
  const disconnectedConnections = useTerminalStore((state) => state.disconnectedConnections)

  const connectedItems = connectedConnections.map((conn) => ({
    key: conn.connectionId,
    label: (
      <SortableTab
        id={conn.connectionId}
        connectionName={conn.connection.name}
        label={
          <ConnectionTab
            connectionId={conn.connectionId}
            connection={conn.connection}
            onClose={onCloseConnection}
          />
        }
      />
    ),
    children: null,
  }))

  const disconnectedItems = disconnectedConnections.map((dc) => ({
    key: dc.connectionId,
    label: (
      <span style={{ color: 'var(--color-error)' }}>
        {dc.connection.name}
        <CloseOutlined
          style={{ marginLeft: 6, fontSize: 10 }}
          onClick={(e) => {
            e.stopPropagation()
            onCloseDisconnected(dc.connectionId)
          }}
        />
      </span>
    ),
    children: (
      <DisconnectedConnectionTab
        disconnectedConnection={dc}
        onClose={onCloseDisconnected}
        onReconnect={onReconnectDisconnected}
      />
    ),
  }))

  return (
    <Tabs
      activeKey={activeConnectionId || undefined}
      onChange={onTabChange}
      items={[...connectedItems, ...disconnectedItems]}
      style={{ height: 40 }}
      tabBarStyle={{ margin: 0, padding: '0 4px', background: 'transparent' }}
      destroyInactiveTabPane={false}
    />
  )
}
