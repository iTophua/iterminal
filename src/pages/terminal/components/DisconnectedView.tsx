import { Button } from 'antd'
import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons'
import type { DisconnectedConnection } from '../../../stores/terminalStore'

interface DisconnectedViewProps {
  connection: DisconnectedConnection
  onReconnect: (conn: DisconnectedConnection) => void
  onRemove: (connectionId: string) => void
}

export function DisconnectedView({
  connection: dc,
  onReconnect,
  onRemove,
}: DisconnectedViewProps) {
  const getReasonText = () => {
    switch (dc.reason) {
      case 'write_failed':
        return '写入失败，可能是网络中断'
      case 'channel_closed':
        return 'SSH Channel 被关闭'
      case 'server_close':
        return '服务器主动关闭连接'
      case 'unknown':
      default:
        return '原因未知'
    }
  }

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
      <DisconnectOutlined style={{ fontSize: 48, color: 'var(--color-error)' }} />
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>连接已断开</p>
      <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>{getReasonText()}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="primary" icon={<ReloadOutlined />} onClick={() => onReconnect(dc)}>
          重新连接
        </Button>
        <Button onClick={() => onRemove(dc.connectionId)}>关闭</Button>
      </div>
    </div>
  )
}