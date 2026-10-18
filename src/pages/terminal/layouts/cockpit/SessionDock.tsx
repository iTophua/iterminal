import React from 'react'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'

export interface DockItem {
  sessionKey: string
  connectionId: string
  sessionId: string
  /** 连接名 */
  title: string
  /** user@host · shell */
  sub: string
  preview: string
  disconnected?: boolean
  focused: boolean
  /** 活动传输进度（0-100，null 无传输） */
  transferProgress?: number | null
  /** 窗口已最小化（会话保留，点击还原） */
  minimized?: boolean
}

interface SessionDockProps {
  items: DockItem[]
  onFocus: (sessionKey: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
}

/**
 * 驾驶舱底部停靠栏：每个会话一张缩略卡（标题 + 末行输出预览），
 * 点击聚焦对应浮动窗口，悬停可快速关闭。
 */
export const SessionDock = React.memo(function SessionDock({ items, onFocus, onClose, onNew }: SessionDockProps) {
  return (
    <div className="ck-dock">
      {items.map(item => (
        <div
          key={item.sessionKey}
          className={`ck-dk${item.focused ? ' on' : ''}${item.minimized ? ' mini' : ''}`}
          onClick={() => onFocus(item.sessionKey)}
          title={`${item.minimized ? '[已最小化] ' : ''}${item.title} · ${item.sub}\n${item.preview}`}
        >
          <span className="fd" />
          <div className="t" style={{ color: item.disconnected ? '#F4576C' : undefined }}>
            {item.title} · {item.sub}
          </div>
          <div className="p">{item.preview || '…'}</div>
          {item.transferProgress != null && <span className="prog" style={{ width: `${item.transferProgress}%` }} />}
          <button
            className="close"
            onClick={e => {
              e.stopPropagation()
              onClose(item.sessionId)
            }}
            title="关闭会话"
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </button>
        </div>
      ))}
      <button className="ck-dk-new" onClick={onNew} title="新会话（从左侧主机墙选择主机）">
        <PlusOutlined style={{ fontSize: 12 }} /> 新会话
      </button>
    </div>
  )
})

/** 从 xterm 缓冲区取最后一行非空输出作为缩略预览 */
export function readTerminalPreview(term: any): string {
  try {
    if (!term?.buffer?.active) return ''
    const buf = term.buffer.active
    for (let i = buf.length - 1; i >= Math.max(0, buf.length - 6); i--) {
      const line = buf.getLine(i)?.translateToString(true)?.trim()
      if (line) return line.slice(0, 60)
    }
  } catch {
  }
  return ''
}
