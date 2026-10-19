import { useCallback, useMemo, useRef, useState } from 'react'
import { App, Button, Form, Input, Modal, Popconfirm, Select } from 'antd'
import { ApiOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ExportOutlined, ImportOutlined, LoadingOutlined, PlusOutlined, SearchOutlined, TagsOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'
import type { ConnectedConnection, Connection } from '../../../../stores/terminalStore'
import { useTerminalStore } from '../../../../stores/terminalStore'
import { saveConnection, deleteConnection, getConnections, exportConnections, importConnections, downloadExportFile } from '../../../../services/database'

interface CockpitConnectionsProps {
  connectedConnections: ConnectedConnection[]
  /** 连接（未连接时发起连接，已连接时聚焦） */
  onConnect: (conn: Connection) => void
}

const GROUP_COLORS: Record<string, string> = {
  '生产环境': '#F4576C',
  '开发环境': '#4CC9E8',
  '测试环境': '#F5B950',
}

/**
 * 驾驶舱原生连接管理：分组筛选 + 卡片网格 + 增删改，
 * 完全使用驾驶舱视觉体系（不嵌入经典布局页面）。
 */
export function CockpitConnections({ connectedConnections, onConnect }: CockpitConnectionsProps) {
  const { message } = App.useApp()
  const allConnections = useTerminalStore(s => s.allConnections)
  const setAllConnections = useTerminalStore(s => s.setAllConnections)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('全部')
  const [editing, setEditing] = useState<Connection | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchGroup, setBatchGroup] = useState<string | undefined>(undefined)
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [testCooldown, setTestCooldown] = useState(false)
  const testIdRef = useRef(0)
  const [form] = Form.useForm()

  /** 用表单当前值做一次真实连接+认证测试（与经典布局表单同一后端命令） */
  const handleTestConnection = useCallback(async () => {
    // 测试进行中再点一次 = 放弃等待结果（后端连接无法中止，仅作废返回）
    if (testCooldown) return
    if (testLoading) {
      testIdRef.current += 1
      setTestLoading(false)
      setTestResult('failed')
      setTestMessage('测试已取消')
      setTestCooldown(true)
      setTimeout(() => setTestCooldown(false), 1500)
      return
    }
    const currentTestId = ++testIdRef.current
    try {
      const values = await form.validateFields(['host', 'port', 'username', 'password', 'keyFile'])
      const port = typeof values.port === 'string' ? parseInt(values.port, 10) || 22 : values.port || 22
      setTestLoading(true)
      setTestResult(null)
      setTestMessage('')
      const t0 = performance.now()
      const result = await invoke<boolean>('test_connection', {
        connection: {
          host: values.host,
          port,
          username: values.username,
          password: values.password || null,
          key_file: values.keyFile || null,
        }
      })
      if (testIdRef.current !== currentTestId) return
      const elapsed = Math.round(performance.now() - t0)
      if (result) {
        setTestResult('success')
        setTestMessage(`连接成功 · ${elapsed}ms`)
      } else {
        setTestResult('failed')
        setTestMessage('认证失败：请检查用户名 / 密码 / 密钥')
      }
    } catch (error) {
      if (testIdRef.current !== currentTestId) return
      if (error && typeof error === 'object' && 'errorFields' in error) return // 表单校验错误，字段上已提示
      setTestResult('failed')
      setTestMessage(`连接失败：${error}`)
    } finally {
      if (testIdRef.current === currentTestId) setTestLoading(false)
    }
  }, [form, testLoading, testCooldown])

  const resetTestState = useCallback(() => {
    testIdRef.current++
    setTestLoading(false)
    setTestResult(null)
    setTestMessage('')
    setTestCooldown(false)
  }, [])

  const groups = useMemo(() => {
    const set = new Set<string>()
    for (const c of allConnections) set.add(c.group || '默认')
    return ['全部', ...Array.from(set)]
  }, [allConnections])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allConnections.filter(c => {
      if (group !== '全部' && (c.group || '默认') !== group) return false
      if (!q) return true
      return `${c.name} ${c.host} ${c.username} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q)
    })
  }, [allConnections, query, group])

  const refresh = useCallback(async () => {
    try {
      const list = await getConnections()
      setAllConnections(list)
    } catch (err) {
      message.error(`刷新连接列表失败: ${err}`)
    }
  }, [setAllConnections, message])

  const openCreate = useCallback(() => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ port: 22, group: '默认' })
    resetTestState()
    setFormOpen(true)
  }, [form, resetTestState])

  const openEdit = useCallback((conn: Connection) => {
    setEditing(conn)
    form.resetFields()
    form.setFieldsValue({
      name: conn.name, host: conn.host, port: conn.port, username: conn.username,
      password: conn.password || '', keyFile: conn.keyFile || '',
      group: conn.group || '默认', tags: (conn.tags || []).join(', '),
    })
    resetTestState()
    setFormOpen(true)
  }, [form, resetTestState])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const conn: Connection = {
        id: editing?.id || `conn-${Date.now()}`,
        name: values.name || `${values.username}@${values.host}`,
        host: values.host,
        port: Number(values.port) || 22,
        username: values.username,
        password: values.password || undefined,
        keyFile: values.keyFile || undefined,
        group: values.group || '默认',
        tags: (values.tags || '').split(/[,，]/).map((t: string) => t.trim()).filter(Boolean),
        status: 'offline',
      }
      const ok = await saveConnection(conn)
      if (!ok) throw new Error('保存失败')
      await refresh()
      message.success(editing ? '连接已更新' : '连接已创建')
      setFormOpen(false)
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return // 表单校验错误
      message.error(`保存失败: ${err}`)
    } finally {
      setSaving(false)
    }
  }, [form, editing, refresh, message])

  /** 复制连接配置：预填表单为新建副本（与经典页语义一致） */
  const openDuplicate = useCallback((conn: Connection) => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      name: `${conn.name} (副本)`,
      host: conn.host, port: conn.port, username: conn.username,
      password: conn.password || '', keyFile: conn.keyFile || '',
      group: conn.group || '默认', tags: (conn.tags || []).join(', '),
    })
    resetTestState()
    setFormOpen(true)
  }, [form, resetTestState])

  const handleDelete = useCallback(async (conn: Connection) => {
    // 已连接的连接先断开，避免残留会话
    if (connectedConnections.some(c => c.connectionId === conn.id)) {
      await invoke('disconnect_ssh', { id: conn.id }).catch(() => {})
      useTerminalStore.getState().closeConnection(conn.id)
    }
    const ok = await deleteConnection(conn.id)
    if (ok) {
      await refresh()
      message.success(`已删除 ${conn.name}`)
    } else {
      message.error('删除失败')
    }
  }, [connectedConnections, refresh, message])

  return (
    <div className="ck-conn">
      <div className="ck-conn-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--ck-t3)', fontSize: 12 }} />}
          placeholder="搜索名称 / 主机 / 用户 / 标签…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="ck-conn-search"
        />
        <div className="ck-gpills">
          {groups.slice(0, 8).map(g => (
            <button key={g} className={`ck-gp${g === group ? ' on' : ''}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button
            className={`ck-conn-tool${batchMode ? ' on' : ''}`}
            title="批量修改分组"
            onClick={() => { setBatchMode(v => !v); setSelected(new Set()); setBatchGroup(undefined) }}
          >
            <TagsOutlined style={{ fontSize: 12 }} /> {batchMode ? '退出批量' : '批量分组'}
          </button>
          <button
            className="ck-conn-tool"
            title="导入连接（合并）"
            onClick={() => document.getElementById('ck-conn-import')?.click()}
          >
            <ImportOutlined style={{ fontSize: 12 }} /> 导入
          </button>
          <input
            id="ck-conn-import"
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                const text = await file.text()
                const n = await importConnections(text, true)
                await refresh()
                message.success(`已导入 ${n} 个连接`)
              } catch (err) {
                message.error(`导入失败: ${err}`)
              }
            }}
          />
          <button
            className="ck-conn-tool"
            title="导出全部连接"
            onClick={async () => {
              try {
                const data = await exportConnections()
                downloadExportFile(data, 'iterminal-connections.json')
                message.success('已导出连接配置')
              } catch (err) {
                message.error(`导出失败: ${err}`)
              }
            }}
          >
            <ExportOutlined style={{ fontSize: 12 }} /> 导出
          </button>
          <button className="ck-conn-new" onClick={openCreate}>
            <PlusOutlined style={{ fontSize: 12 }} /> 新建连接
          </button>
        </div>
      </div>

      {batchMode && (
        <div className="ck-conn-batch">
          已选 {selected.size} 项
          <Select
            size="small"
            allowClear
            placeholder="选择目标分组"
            value={batchGroup}
            onChange={setBatchGroup}
            style={{ width: 150 }}
            options={groups.filter(g => g !== '全部').map(g => ({ value: g, label: g }))}
          />
          <button
            className="ck-conn-tool"
            disabled={selected.size === 0 || !batchGroup}
            onClick={async () => {
              for (const id of selected) {
                const c = allConnections.find(x => x.id === id)
                if (c) await saveConnection({ ...c, group: batchGroup! })
              }
              await refresh()
              message.success(`已将 ${selected.size} 个连接移入「${batchGroup}」`)
              setSelected(new Set())
              setBatchMode(false)
            }}
          >
            应用
          </button>
          <button className="ck-conn-tool" onClick={() => { setSelected(new Set()) }}>清空选择</button>
        </div>
      )}

      <div className="ck-conn-grid">
        {filtered.map(conn => {
          const connected = connectedConnections.some(c => c.connectionId === conn.id)
          const sessionCount = connected
            ? connectedConnections.find(c => c.connectionId === conn.id)!.rootPane.sessions.length
            : 0
          const isSelected = selected.has(conn.id)
          return (
            <div
              key={conn.id}
              className={`ck-conn-card${connected ? ' on' : ''}${isSelected ? ' picked' : ''}`}
              onClick={() => {
                if (batchMode) {
                  setSelected(prev => {
                    const next = new Set(prev)
                    if (next.has(conn.id)) next.delete(conn.id)
                    else next.add(conn.id)
                    return next
                  })
                  return
                }
                onConnect(conn)
              }}
              title={batchMode ? `${conn.name} · 点击选择` : connected ? `${conn.name} · ${sessionCount} 个会话 · 点击聚焦` : `${conn.name} · 点击连接`}
            >
              <span className="ck-conn-stripe" style={{ background: GROUP_COLORS[conn.group] || 'var(--ck-accent)' }} />
              <div className="ck-conn-main">
                <div className="ck-conn-name">
                  <span className={`ck-dot${connected ? '' : ' off'}`} style={{ width: 6, height: 6 }} />
                  {conn.name}
                </div>
                <div className="ck-conn-host">{conn.username}@{conn.host}:{conn.port}</div>
                <div className="ck-conn-meta">
                  <span className="ck-conn-group">{conn.group || '默认'}</span>
                  {connected && <span className="ck-conn-sessions">{sessionCount} 会话</span>}
                  {conn.tags?.slice(0, 2).map(t => <span key={t} className="ck-conn-tag">#{t}</span>)}
                </div>
              </div>
              {!batchMode && (
              <div className="ck-conn-acts" onClick={e => e.stopPropagation()}>
                <button title="复制配置为新建" onClick={() => openDuplicate(conn)}><CopyOutlined style={{ fontSize: 12 }} /></button>
                <button title="编辑" onClick={() => openEdit(conn)}><EditOutlined style={{ fontSize: 12 }} /></button>
                <Popconfirm title={`删除 ${conn.name}？`} description="该操作不可撤销" okText="删除" cancelText="取消" onConfirm={() => handleDelete(conn)}>
                  <button title="删除" className="danger"><DeleteOutlined style={{ fontSize: 12 }} /></button>
                </Popconfirm>
              </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="ck-conn-empty">
            {allConnections.length === 0 ? '还没有保存的连接，点击右上「新建连接」开始' : '没有匹配的连接'}
          </div>
        )}
      </div>

      <Modal
        title={editing ? `编辑连接 · ${editing.name}` : '新建连接'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={
          <>
            <Button
              disabled={testCooldown}
              icon={testLoading ? <LoadingOutlined /> : <ApiOutlined />}
              onClick={handleTestConnection}
              style={{ marginRight: 'auto' }}
            >
              {testLoading ? '取消测试' : '测试连接'}
            </Button>
            <Button onClick={() => setFormOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
          </>
        }
        width={460}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 12 }}
          onValuesChange={changed => {
            // 连接相关字段变化后旧测试结果不再可信，立即清空
            if (testMessage && ['host', 'port', 'username', 'password', 'keyFile'].some(f => f in changed)) {
              setTestResult(null)
              setTestMessage('')
            }
          }}
        >
          <Form.Item name="name" label="名称"><Input placeholder="留空则自动使用 user@host" /></Form.Item>
          <div style={{ display: 'flex', gap: 8 }}>
            <Form.Item name="host" label="主机" rules={[{ required: true, message: '请输入主机地址' }]} style={{ flex: 1 }}>
              <Input placeholder="192.168.1.10 或域名" />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true }]} style={{ width: 90 }}>
              <Input type="number" min={1} max={65535} />
            </Form.Item>
          </div>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="root" />
          </Form.Item>
          <Form.Item name="password" label="密码"><Input.Password placeholder="密码认证（可留空）" autoComplete="new-password" /></Form.Item>
          <Form.Item name="keyFile" label="私钥路径"><Input placeholder="/Users/you/.ssh/id_rsa（可留空）" /></Form.Item>
          <div style={{ display: 'flex', gap: 8 }}>
            <Form.Item name="group" label="分组" style={{ flex: 1 }}>
              <Select
                allowClear
                mode="tags"
                maxCount={1}
                placeholder="选择或输入分组"
                options={groups.filter(g => g !== '全部').map(g => ({ value: g, label: g }))}
              />
            </Form.Item>
            <Form.Item name="tags" label="标签" style={{ flex: 1 }}>
              <Input placeholder="逗号分隔，如: web, 生产" />
            </Form.Item>
          </div>
          {testMessage && (
            <div style={{
              fontSize: 12,
              color: testResult === 'success' ? '#52C41A' : '#F4576C',
              marginTop: -12, marginBottom: 4,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}>
              {testResult === 'success' ? '✓ ' : '✕ '}{testMessage}
            </div>
          )}
        </Form>
      </Modal>
    </div>
  )
}
