import React from 'react'
import { XOutlined } from '@ant-design/icons'

export type CockpitDrawerTab = 'files' | 'monitor' | 'docker' | 'ports' | 'ai'

export const COCKPIT_DRAWER_TABS: { key: CockpitDrawerTab; label: string }[] = [
  { key: 'files', label: '文件' },
  { key: 'monitor', label: '监控' },
  { key: 'docker', label: 'Docker' },
  { key: 'ports', label: '端口' },
  { key: 'ai', label: 'AI' },
]

interface ToolDrawerProps {
  activeTab: CockpitDrawerTab
  onTabChange: (tab: CockpitDrawerTab) => void
  onClose: () => void
  /** 面板内容（由 Terminal.tsx 注入，复用经典布局的面板组件与 props） */
  children: React.ReactNode
}

/**
 * 驾驶舱右侧工具抽屉：文件 / 监控 / Docker / 端口 / AI。
 * 面板本体复用经典布局的组件，仅更换宿主容器。
 */
export const ToolDrawer = React.memo(function ToolDrawer({
  activeTab,
  onTabChange,
  onClose,
  children,
}: ToolDrawerProps) {
  return (
    <aside className="ck-drawer">
      <div className="ck-dr-h">
        工具
        <button onClick={onClose} title="收起抽屉" style={{ color: 'var(--ck-t3)', display: 'flex', padding: 2 }}>
          <XOutlined style={{ fontSize: 13 }} />
        </button>
      </div>
      <div className="ck-dr-tabs">
        {COCKPIT_DRAWER_TABS.map(t => (
          <button
            key={t.key}
            className={t.key === activeTab ? 'on' : ''}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ck-dr-body">{children}</div>
    </aside>
  )
})
