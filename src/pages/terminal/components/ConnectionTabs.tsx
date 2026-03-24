import { Tabs } from 'antd'
import { useTerminalStore } from '../../../stores/terminalStore'
import { ConnectionTab, SortableTab } from './ConnectionTab'

interface ConnectionTabsProps {
  activeConnectionId: string | null
  onTabChange: (connectionId: string) => void
  onCloseConnection: (connectionId: string) => void
}

export function ConnectionTabs({
  activeConnectionId,
  onTabChange,
  onCloseConnection,
}: ConnectionTabsProps) {
  const connectedConnections = useTerminalStore((state) => state.connectedConnections)

  const items = connectedConnections.map((conn) => ({
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

  return (
    <Tabs
      activeKey={activeConnectionId || undefined}
      onChange={onTabChange}
      items={items}
      style={{ height: 40 }}
      tabBarStyle={{ margin: 0, padding: '0 4px', background: 'transparent' }}
      destroyInactiveTabPane={false}
    />
  )
}