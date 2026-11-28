import { useState } from 'react'
import { Alert, App, Button, Checkbox, Modal, Select, Space, Tag, Typography } from 'antd'
import { FileTextOutlined, KeyOutlined } from '@ant-design/icons'
import { importSshConfig, previewSshConfig, type SshConfigEntry } from '../services/sshConfig'

interface Props {
  /** 导入完成后通知外层刷新列表 */
  onImported?: () => void
  /** 驾驶舱工具栏用自定义样式的按钮时传 */
  buttonClassName?: string
}

/** 「导入 ~/.ssh/config」按钮 + 预览勾选弹窗 */
export default function SshConfigImport({ onImported, buttonClassName }: Props) {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<SshConfigEntry[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [group, setGroup] = useState<string>('默认')
  const [importing, setImporting] = useState(false)

  const load = async () => {
    setOpen(true)
    setEntries(null)
    setError('')
    try {
      const list = await previewSshConfig()
      setEntries(list)
      setSelected(list.filter(entry => !entry.unsupported).map(entry => entry.alias))
    } catch (e) {
      setError(String(e))
    }
  }

  const run = async () => {
    const chosen = (entries ?? []).filter(entry => selected.includes(entry.alias) && !entry.unsupported)
    if (chosen.length === 0) return
    setImporting(true)
    try {
      const result = await importSshConfig(chosen, group)
      const skipped = result.skipped.length ? `，${result.skipped.length} 个已存在跳过` : ''
      message.success(`已导入 ${result.imported} 个连接${skipped}`)
      setOpen(false)
      window.dispatchEvent(new CustomEvent('connections-updated'))
      onImported?.()
    } catch (e) {
      message.error(`导入失败: ${e}`)
    } finally {
      setImporting(false)
    }
  }

  const trigger = buttonClassName ? (
    <button className={buttonClassName} title="导入 ~/.ssh/config" onClick={() => void load()}>
      <FileTextOutlined style={{ fontSize: 12 }} /> ssh config
    </button>
  ) : (
    <Button icon={<FileTextOutlined />} onClick={() => void load()}>
      导入 ssh config
    </Button>
  )

  return (
    <>
      {trigger}
      <Modal
        title="导入 ~/.ssh/config"
        open={open}
        okText={`导入 ${selected.length} 个`}
        okButtonProps={{ disabled: selected.length === 0, loading: importing }}
        cancelText="取消"
        onCancel={() => setOpen(false)}
        onOk={() => void run()}
        width={640}
      >
        {error && <Alert type="error" showIcon message={error} />}
        {entries === null && !error && <Typography.Text type="secondary">正在读取…</Typography.Text>}
        {entries && entries.length === 0 && (
          <Alert type="info" showIcon message="~/.ssh/config 里没有可导入的 Host 配置" />
        )}
        {entries && entries.length > 0 && (
          <>
            <div style={{ maxHeight: 360, overflow: 'auto', marginBottom: 12 }}>
              {entries.map(entry => (
                <div key={entry.alias} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <Checkbox
                    checked={selected.includes(entry.alias)}
                    disabled={!!entry.unsupported}
                    onChange={e =>
                      setSelected(prev =>
                        e.target.checked ? [...prev, entry.alias] : prev.filter(alias => alias !== entry.alias),
                      )
                    }
                  >
                    <Typography.Text strong>{entry.alias}</Typography.Text>
                    <Typography.Text type="secondary">
                      {' '}
                      {entry.user ? `${entry.user}@` : ''}
                      {entry.host_name}:{entry.port}
                    </Typography.Text>
                    {entry.identity_file && (
                      <Tag icon={<KeyOutlined />} style={{ marginLeft: 8 }}>
                        私钥
                      </Tag>
                    )}
                    {entry.proxy_jump && <Tag color="blue">经 {entry.proxy_jump}</Tag>}
                    {entry.unsupported && <Tag color="warning">{entry.unsupported} 暂不支持</Tag>}
                  </Checkbox>
                </div>
              ))}
            </div>
            <Space>
              <Typography.Text>导入到分组</Typography.Text>
              <Select
                mode="tags"
                value={[group]}
                onChange={value => setGroup(value[0] || '默认')}
                options={['默认', '生产环境', '开发环境', '测试环境'].map(name => ({ value: name, label: name }))}
                style={{ width: 200 }}
              />
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
              没写 User 的用本机用户名；只带私钥路径，密码需要之后自行填写。主机和用户名都相同的连接不会重复导入。
            </Typography.Paragraph>
          </>
        )}
      </Modal>
    </>
  )
}
