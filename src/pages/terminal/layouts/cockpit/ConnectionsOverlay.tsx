import { useEffect } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { CockpitConnections } from './CockpitConnections'
import type { ConnectedConnection, Connection } from '../../../../stores/terminalStore'

/**
 * 驾驶舱内的连接管理浮层：驾驶舱原生卡片网格 + 增删改，
 * 连接成功后由 CockpitLayout 关闭浮层并聚焦新窗口。
 */
export function ConnectionsOverlay({
  connectedConnections,
  onConnect,
  onClose,
}: {
  connectedConnections: ConnectedConnection[]
  onConnect: (conn: Connection) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="ck-manage-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ck-manage" role="dialog" aria-label="连接管理">
        <div className="ck-manage-h">
          <b>连接管理</b>
          <span className="ck-manage-sub">点击卡片连接 / 聚焦；悬停操作按钮可编辑、删除</span>
          <button className="ck-manage-x" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <CloseOutlined style={{ fontSize: 13 }} />
          </button>
        </div>
        <div className="ck-manage-body">
          <CockpitConnections connectedConnections={connectedConnections} onConnect={onConnect} />
        </div>
      </div>
    </div>
  )
}
