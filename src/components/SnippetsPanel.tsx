import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button, Tooltip, Empty, Input, Modal, Form, Select, App, Tag } from 'antd'
import {
  CloseOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { listSnippets, saveSnippet, deleteSnippet, type Snippet } from '../services/snippets'

interface SnippetsPanelProps {
  onClose: () => void
  /** 将命令插入当前活动终端的输入行（不自动执行） */
  onInsert?: (command: string) => void
}

export default function SnippetsPanel({ onClose, onInsert }: SnippetsPanelProps) {
  const { message } = App.useApp()
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)
  const [editVisible, setEditVisible] = useState(false)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [form] = Form.useForm()

  const loadSnippets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listSnippets()
      setSnippets(data)
    } catch (err) {
      message.error(`加载片段失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    loadSnippets()
  }, [loadSnippets])

  // 提取所有分类用于筛选
  const categories = useMemo(() => {
    const set = new Set<string>()
    snippets.forEach(s => { if (s.category) set.add(s.category) })
    return Array.from(set)
  }, [snippets])

  const filtered = useMemo(() => {
    return snippets.filter(s => {
      if (categoryFilter && s.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          s.title.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          (s.description?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }, [snippets, categoryFilter, search])

  const handleCopy = useCallback(async (cmd: string) => {
    try {
      await writeText(cmd)
      message.success('已复制到剪贴板')
    } catch (err) {
      message.error(`复制失败: ${err}`)
    }
  }, [message])

  const handleInsert = useCallback((cmd: string) => {
    if (onInsert) {
      onInsert(cmd)
      message.success('已插入终端')
    } else {
      handleCopy(cmd)
    }
  }, [onInsert, handleCopy, message])

  const handleEdit = useCallback((snippet: Snippet | null) => {
    setEditing(snippet)
    if (snippet) {
      // category 在 Select(tags) 模式下需是数组
      form.setFieldsValue({
        title: snippet.title,
        command: snippet.command,
        description: snippet.description || '',
        category: snippet.category ? [snippet.category] : [],
      })
    } else {
      form.resetFields()
    }
    setEditVisible(true)
  }, [form])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      // category 字段是 tags 模式的数组，取第一个元素（或 undefined）
      const rawCategory = values.category
      const category = Array.isArray(rawCategory)
        ? rawCategory[0]
        : (rawCategory || undefined)
      await saveSnippet({
        id: editing?.id,
        title: values.title,
        command: values.command,
        description: values.description || undefined,
        category,
      })
      message.success(editing ? '已更新' : '已创建')
      setEditVisible(false)
      loadSnippets()
    } catch (err) {
      // validateFields 失败时不报错（表单自带提示），仅 invoke 错误提示
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(`保存失败: ${err}`)
    }
  }, [form, editing, loadSnippets, message])

  const handleDelete = useCallback(async (id: string, title: string) => {
    Modal.confirm({
      title: '删除片段',
      content: `确定删除「${title}」？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteSnippet(id)
          message.success('已删除')
          loadSnippets()
        } catch (err) {
          message.error(`删除失败: ${err}`)
        }
      },
    })
  }, [loadSnippets, message])

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
          <ThunderboltOutlined style={{ color: 'var(--color-primary)' }} />
          命令片段库
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="新建片段">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => handleEdit(null)} />
          </Tooltip>
          <Tooltip title="关闭">
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </div>
      </div>

      {/* 搜索与筛选 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <Input
          size="small"
          allowClear
          placeholder="搜索..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <Select
          size="small"
          allowClear
          placeholder="分类"
          value={categoryFilter}
          onChange={v => setCategoryFilter(v)}
          style={{ width: 100 }}
          options={categories.map(c => ({ label: c, value: c }))}
        />
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {filtered.length === 0 && !loading ? (
          <Empty
            description={search || categoryFilter ? '无匹配片段' : '暂无片段，点击 + 创建'}
            style={{ marginTop: 40 }}
          />
        ) : (
          filtered.map(s => (
            <div
              key={s.id}
              style={{
                padding: '8px 10px',
                marginBottom: 6,
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                background: 'var(--color-bg-elevated)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>{s.title}</span>
                    {s.category && <Tag style={{ margin: 0, fontSize: 11 }}>{s.category}</Tag>}
                  </div>
                  <code style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    background: 'var(--color-fill)',
                    padding: '4px 6px',
                    borderRadius: 3,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontFamily: 'Menlo, Monaco, monospace',
                  }}>
                    {s.command}
                  </code>
                  {s.description && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                      {s.description}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, marginTop: 6, justifyContent: 'flex-end' }}>
                <Tooltip title="插入终端">
                  <Button size="small" type="text" icon={<ThunderboltOutlined />} onClick={() => handleInsert(s.command)} disabled={!onInsert} />
                </Tooltip>
                <Tooltip title="复制">
                  <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopy(s.command)} />
                </Tooltip>
                <Tooltip title="编辑">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEdit(s)} />
                </Tooltip>
                <Tooltip title="删除">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(s.id, s.title)} />
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 编辑/新建对话框 */}
      <Modal
        title={editing ? '编辑片段' : '新建片段'}
        open={editVisible}
        onOk={handleSave}
        onCancel={() => setEditVisible(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：重启 nginx" allowClear autoFocus />
          </Form.Item>
          <Form.Item name="command" label="命令" rules={[{ required: true, message: '请输入命令' }]}>
            <Input.TextArea placeholder="systemctl restart nginx" autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="description" label="说明（可选）">
            <Input placeholder="这条命令的用途" allowClear />
          </Form.Item>
          <Form.Item name="category" label="分类（可选）">
            <Select
              allowClear
              placeholder="选择或输入分类"
              mode="tags"
              maxCount={1}
              options={categories.map(c => ({ label: c, value: c }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
