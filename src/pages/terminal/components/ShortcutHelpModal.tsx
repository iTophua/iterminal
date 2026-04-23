import { Modal, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState, useEffect } from 'react'
import { useTerminalStore } from '../../../stores/terminalStore'

interface ShortcutItem {
  action: string
  shortcut: string
  category: string
}

interface ShortcutHelpModalProps {
  visible: boolean
  onClose: () => void
}

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

export function ShortcutHelpModal({ visible, onClose }: ShortcutHelpModalProps) {
  const shortcutSettings = useTerminalStore(state => state.shortcutSettings)
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>([])

  useEffect(() => {
    const items: ShortcutItem[] = [
      { action: '清屏', shortcut: shortcutSettings.clearScreen, category: 'terminal' },
      { action: '搜索终端内容', shortcut: shortcutSettings.search, category: 'edit' },
      { action: '复制选中内容', shortcut: shortcutSettings.copy, category: 'edit' },
      { action: '粘贴内容', shortcut: shortcutSettings.paste, category: 'edit' },
      { action: '新建会话', shortcut: shortcutSettings.newSession, category: 'session' },
      { action: '关闭当前会话', shortcut: shortcutSettings.closeSession, category: 'session' },
      { action: '切换到下一个会话', shortcut: shortcutSettings.nextSession, category: 'session' },
      { action: '切换到上一个会话', shortcut: shortcutSettings.prevSession, category: 'session' },
      { action: '水平分屏', shortcut: shortcutSettings.splitHorizontal, category: 'session' },
      { action: '垂直分屏', shortcut: shortcutSettings.splitVertical, category: 'session' },
      { action: '全屏切换', shortcut: shortcutSettings.fullscreen, category: 'terminal' },
      { action: '查看命令历史', shortcut: shortcutSettings.showHistory, category: 'edit' },
      { action: '快捷键帮助', shortcut: shortcutSettings.shortcutHelp, category: 'edit' },
      { action: '下一个自动补全建议', shortcut: shortcutSettings.nextSuggestion, category: 'edit' },
      { action: '上一个自动补全建议', shortcut: shortcutSettings.prevSuggestion, category: 'edit' },
    ]
    setShortcuts(items)
  }, [shortcutSettings])

  const columns: ColumnsType<ShortcutItem> = [
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: '55%',
    },
    {
      title: '快捷键',
      dataIndex: 'shortcut',
      key: 'shortcut',
      width: '45%',
      render: (shortcut: string) => (
        <Tag color="default" style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {shortcut.split('+').map((key, i, arr) => {
            const displayKey = key === 'Cmd' ? (isMac ? '⌘' : 'Cmd') :
              key === 'Alt' ? (isMac ? '⌥' : 'Alt') :
              key === 'Ctrl' ? (isMac ? '⌃' : 'Ctrl') :
              key === 'Shift' ? (isMac ? '⇧' : 'Shift') :
              key
            return (
              <span key={i}>
                {displayKey}
                {i < arr.length - 1 && <span style={{ margin: '0 3px', color: 'var(--color-text-tertiary)' }}>+</span>}
              </span>
            )
          })}
        </Tag>
      ),
    },
  ]

  return (
    <Modal
      title="⌨️ 快捷键列表"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <Table
        columns={columns}
        dataSource={shortcuts}
        rowKey="action"
        pagination={false}
        size="small"
        style={{ marginTop: 12 }}
      />
      <div style={{ marginTop: 16, padding: 12, background: 'var(--color-bg-spotlight)', borderRadius: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          💡 提示
        </div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <li>在终端中输入 <kbd style={{ padding: '1px 4px', background: 'var(--color-bg-elevated)', borderRadius: 3 }}>Tab</kbd> 可触发命令历史自动补全</li>
          <li>连接断开后按 <kbd style={{ padding: '1px 4px', background: 'var(--color-bg-elevated)', borderRadius: 3 }}>Enter</kbd> 可快速重连</li>
          <li>拖拽连接 Tab 到窗口边缘 60px 区域可创建新窗口</li>
        </ul>
      </div>
    </Modal>
  )
}
