import { Tabs, Button } from 'antd'
import { DisconnectOutlined, PlusOutlined } from '@ant-design/icons'

export interface SessionTabItem {
  id: string
  title: string
}

interface TerminalTabsProps {
  sessions: SessionTabItem[]
  activeSessionId: string | null
  onSessionChange: (sessionId: string) => void
  onNewSession: () => void
  onCloseSession: (sessionId: string) => void
}

export function TerminalTabs({
  sessions,
  activeSessionId,
  onSessionChange,
  onNewSession,
  onCloseSession,
}: TerminalTabsProps) {
  const tabItems = sessions.map(s => ({
    key: s.id,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {s.title}
        <DisconnectOutlined 
          style={{ fontSize: 9, cursor: 'pointer', opacity: 0.6 }}
          onClick={(e) => { e.stopPropagation(); onCloseSession(s.id) }}
        />
      </span>
    ),
  }))

  return (
    <Tabs
      activeKey={activeSessionId || undefined}
      onChange={onSessionChange}
      items={tabItems}
      style={{ height: 28 }}
      tabBarStyle={{ margin: 0, padding: 0, background: 'transparent' }}
      tabBarExtraContent={
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={onNewSession}
        />
      }
    />
  )
}