import { useEffect, useState, useCallback } from 'react'
import { Button, Tooltip, Empty, Input, InputNumber, Modal, App, Tag, Popconfirm } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  LinkOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  listPortForwards,
  startPortForward,
  stopPortForward,
  type PortForwardInfo,
} from '../services/portForward'

interface PortForwardPanelProps {
  connectionId: string
  onClose: () => void
}

export default function PortForwardPanel({ connectionId, onClose }: PortForwardPanelProps) {
  const { message } = App.useApp()
  const [forwards, setForwards] = useState<PortForwardInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [addVisible, setAddVisible] = useState(false)
  const [localPort, setLocalPort] = useState<number>(8080)
  const [remoteHost, setRemoteHost] = useState('127.0.0.1')
  const [remotePort, setRemotePort] = useState<number>(3306)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listPortForwards()
      setForwards(data)
    } catch (err) {
      message.error(`加载转发列表失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = useCallback(async () => {
    if (!remoteHost.trim()) {
      message.warning('请输入远程主机')
      return
    }
    if (remotePort <= 0 || remotePort > 65535) {
      message.warning('远程端口无效')
      return
    }
    if (localPort <= 0 || localPort > 65535) {
      message.warning('本地端口无效')
      return
    }
    setSubmitting(true)
    try {
      await startPortForward({
        connectionId,
        localPort,
        remoteHost: remoteHost.trim(),
        remotePort,
      })
      message.success('端口转发已启动')
      setAddVisible(false)
      load()
    } catch (err) {
      message.error(`启动失败: ${err}`)
    } finally {
      setSubmitting(false)
    }
  }, [connectionId, localPort, remoteHost, remotePort, load, message])

  const handleStop = useCallback(async (id: string) => {
    try {
      await stopPortForward(id)
      message.success('已停止')
      load()
    } catch (err) {
      message.error(`停止失败: ${err}`)
    }
  }, [load, message])

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-bg-container)',
    }}>
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <LinkOutlined style={{ color: 'var(--color-primary)' }} />
          端口转发
          <Tag color="gold" style={{ marginLeft: 6 }}>Pro</Tag>
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="刷新">
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading} />
          </Tooltip>
          <Tooltip title="新建转发">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setAddVisible(true)} />
          </Tooltip>
          <Tooltip title="关闭">
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </div>
      </div>

      {/* 说明 */}
      <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        本地转发（ssh -L）：把远程主机的端口映射到本机。访问 127.0.0.1:本地端口 即等于访问远程主机:远程端口。
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {forwards.length === 0 ? (
          <Empty description="暂无转发，点击 + 创建" style={{ marginTop: 40 }} />
        ) : (
          forwards.map(f => (
            <div
              key={f.id}
              style={{
                padding: '10px 12px',
                marginBottom: 6,
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                background: 'var(--color-bg-elevated)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <code style={{ fontSize: 13, color: 'var(--color-primary)', fontFamily: 'Menlo, Monaco, monospace' }}>
                    127.0.0.1:{f.local_port}
                  </code>
                  <LinkOutlined style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} />
                  <code style={{ fontSize: 13, color: 'var(--color-text)', fontFamily: 'Menlo, Monaco, monospace' }}>
                    {f.remote_host}:{f.remote_port}
                  </code>
                </div>
                <Tag color="green" style={{ margin: 0, fontSize: 10 }}>运行中</Tag>
              </div>
              <Popconfirm
                title="停止此转发？"
                onConfirm={() => handleStop(f.id)}
                okText="停止"
                cancelText="取消"
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          ))
        )}
      </div>

      {/* 新建对话框 */}
      <Modal
        title="新建端口转发"
        open={addVisible}
        onOk={handleAdd}
        onCancel={() => setAddVisible(false)}
        confirmLoading={submitting}
        okText="启动"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            把本机端口转发到远程主机（通过当前 SSH 连接）
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, width: 80 }}>本地端口</span>
            <InputNumber
              min={1}
              max={65535}
              value={localPort}
              onChange={v => setLocalPort(Number(v) || 0)}
              style={{ width: 120 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, width: 80 }}>远程主机</span>
            <Input
              value={remoteHost}
              onChange={e => setRemoteHost(e.target.value)}
              placeholder="127.0.0.1"
              style={{ flex: 1 }}
              allowClear
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, width: 80 }}>远程端口</span>
            <InputNumber
              min={1}
              max={65535}
              value={remotePort}
              onChange={v => setRemotePort(Number(v) || 0)}
              style={{ width: 120 }}
            />
          </div>
          <div style={{ marginTop: 12, padding: 8, background: 'var(--color-fill)', borderRadius: 3, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            示例：本地端口 3306，远程 127.0.0.1:3306 → 本机访问 127.0.0.1:3306 即访问服务器的 MySQL
          </div>
        </div>
      </Modal>
    </div>
  )
}
