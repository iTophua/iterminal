import { useCallback, useEffect, useState } from 'react'
import { Button, Divider, Popconfirm, Tag, Typography, message } from 'antd'
import { DeleteOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { forgetHostKey, getKnownHosts, type KnownHost } from '../services/hostKey'

const { Text } = Typography

/** 设置 → 安全：已信任的主机密钥 */
export default function KnownHostsSettings() {
  const [hosts, setHosts] = useState<KnownHost[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setHosts(await getKnownHosts())
      setError('')
    } catch (e) {
      setHosts([])
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleForget = async (host: KnownHost) => {
    try {
      await forgetHostKey(host.host, host.port, host.key_type)
      message.success(`已忘记 ${host.host}:${host.port} 的密钥，下次连接会重新询问`)
      await load()
    } catch (e) {
      message.error(`操作失败: ${e}`)
    }
  }

  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{ marginBottom: 16 }}>
        <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>
          <SafetyCertificateOutlined style={{ marginRight: 8 }} />主机密钥校验
        </Text>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          首次连接时会请你核对服务器的主机密钥指纹；信任后密钥一旦变化会阻止连接并警告，
          防止密码被发到冒充的机器上。服务器重装或更换密钥后，在这里删掉旧记录再连接。
        </Text>
      </div>

      <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>
          已信任的主机{hosts ? `（${hosts.length}）` : ''}
        </Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={hosts === null}>
          刷新
        </Button>
      </div>

      {error && <Text type="danger">{error}</Text>}

      {hosts && hosts.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          还没有信任过任何主机。用户自己的 ~/.ssh/known_hosts 里已有的信任会被直接沿用，不会列在这里。
        </Text>
      )}

      {hosts?.map(host => (
        <div
          key={`${host.host}:${host.port}:${host.key_type}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 0',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Text code style={{ fontSize: 13 }}>{host.host}:{host.port}</Text>
            <Tag style={{ marginLeft: 8 }}>{host.key_type}</Tag>
            <Text code copyable={{ text: host.fingerprint }} style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
              {host.fingerprint}
            </Text>
            {host.first_seen_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>信任于 {host.first_seen_at.replace('T', ' ')} UTC</Text>
            )}
          </div>
          <Popconfirm
            title="忘记这台主机的密钥？"
            description="下次连接会重新询问是否信任"
            okText="忘记"
            cancelText="取消"
            onConfirm={() => void handleForget(host)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      ))}
    </div>
  )
}
