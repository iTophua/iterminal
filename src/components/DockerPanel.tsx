import { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Tooltip, Empty, Select, App, Tag, Spin, Tabs, Switch } from 'antd'
import type { TabsProps } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  DeploymentUnitOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CaretRightOutlined,
  StopOutlined,
  DeleteOutlined,
  ReloadOutlined as RestartIcon,
  CodeOutlined,
  CopyOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  listContainers,
  containerAction,
  containerLogs,
  listImages,
  removeImage,
  type ContainerInfo,
  type ImageInfo,
  type ContainerAction as DockerAction,
} from '../services/docker'
import ContainerTerminalModal from './ContainerTerminalModal'

interface DockerPanelProps {
  connectionId: string | null
  onClose: () => void
}

export default function DockerPanel({ connectionId, onClose }: DockerPanelProps) {
  const { message, modal } = App.useApp()
  const [activeTab, setActiveTab] = useState('containers')

  // 容器
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [loadingContainers, setLoadingContainers] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(5000)
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 镜像
  const [images, setImages] = useState<ImageInfo[]>([])
  const [loadingImages, setLoadingImages] = useState(false)

  // 日志
  const [logContainer, setLogContainer] = useState<ContainerInfo | null>(null)
  const [logs, setLogs] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logTail, setLogTail] = useState(500)

  // 容器终端
  const [terminalContainer, setTerminalContainer] = useState<ContainerInfo | null>(null)

  // ---- 加载容器 ----
  const fetchContainers = useCallback(async () => {
    if (!connectionId) return
    setLoadingContainers(true)
    try {
      const list = await listContainers(connectionId, showAll)
      setContainers(list)
    } catch (err) {
      message.error(`加载容器失败: ${err}`)
    } finally {
      setLoadingContainers(false)
    }
  }, [connectionId, showAll, message])

  const fetchImages = useCallback(async () => {
    if (!connectionId) return
    setLoadingImages(true)
    try {
      const list = await listImages(connectionId)
      setImages(list)
    } catch (err) {
      message.error(`加载镜像失败: ${err}`)
    } finally {
      setLoadingImages(false)
    }
  }, [connectionId, message])

  const fetchLogs = useCallback(async (containerId: string, tail: number) => {
    if (!connectionId) return
    setLoadingLogs(true)
    try {
      const text = await containerLogs(connectionId, containerId, tail)
      setLogs(text)
    } catch (err) {
      message.error(`获取日志失败: ${err}`)
      setLogs('')
    } finally {
      setLoadingLogs(false)
    }
  }, [connectionId, message])

  // 容器自动刷新
  useEffect(() => {
    if (activeTab !== 'containers' || !connectionId || paused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    const initialTimer = setTimeout(() => {
      fetchContainers()
      intervalRef.current = setInterval(fetchContainers, refreshInterval)
    }, 200)
    return () => {
      clearTimeout(initialTimer)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [activeTab, connectionId, paused, refreshInterval, fetchContainers])

  // 切到镜像 tab 时加载
  useEffect(() => {
    if (activeTab === 'images' && connectionId && images.length === 0) {
      fetchImages()
    }
  }, [activeTab, connectionId, images.length, fetchImages])

  // ---- 容器操作 ----
  const handleAction = useCallback((c: ContainerInfo, action: DockerAction) => {
    if (!connectionId) return
    const labels: Record<DockerAction, string> = {
      start: '启动', stop: '停止', restart: '重启', kill: '强制停止', remove: '删除',
    }
    const danger = action === 'remove' || action === 'kill'
    const doAction = async () => {
      try {
        await containerAction(connectionId, c.id, action)
        message.success(`${labels[action]}成功`)
        fetchContainers()
      } catch (err) {
        message.error(`${labels[action]}失败: ${err}`)
      }
    }
    if (danger) {
      modal.confirm({
        title: `${labels[action]}容器`,
        content: `确定${labels[action]}容器「${c.name}」吗？${action === 'remove' ? '此操作不可恢复。' : ''}`,
        okText: labels[action],
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: doAction,
      })
    } else {
      doAction()
    }
  }, [connectionId, message, modal, fetchContainers])

  const handleRemoveImage = useCallback((img: ImageInfo) => {
    if (!connectionId) return
    modal.confirm({
      title: '删除镜像',
      content: `确定删除镜像「${img.repository}:${img.tag}」（${img.size}）吗？此操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await removeImage(connectionId, img.id)
          message.success('已删除')
          fetchImages()
        } catch (err) {
          message.error(`删除失败: ${err}`)
        }
      },
    })
  }, [connectionId, message, modal, fetchImages])

  const handleViewLogs = useCallback((c: ContainerInfo) => {
    setLogContainer(c)
    setActiveTab('logs')
    setLogs('')
    fetchLogs(c.id, logTail)
  }, [logTail, fetchLogs])

  const handleOpenTerminal = useCallback((c: ContainerInfo) => {
    setTerminalContainer(c)
  }, [])

  const handleCopyLogs = useCallback(async () => {
    try {
      await writeText(logs)
      message.success('已复制')
    } catch (err) {
      message.error(`复制失败: ${err}`)
    }
  }, [logs, message])

  // ---- Tabs 配置 ----
  const tabs: TabsProps['items'] = [
    {
      key: 'containers',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DeploymentUnitOutlined /> 容器
        </span>
      ),
      children: (
        <ContainersTab
          containers={containers}
          loading={loadingContainers}
          connectionId={connectionId}
          showAll={showAll}
          setShowAll={setShowAll}
          refreshInterval={refreshInterval}
          setRefreshInterval={setRefreshInterval}
          paused={paused}
          setPaused={setPaused}
          onRefresh={fetchContainers}
          onAction={handleAction}
          onViewLogs={handleViewLogs}
          onOpenTerminal={handleOpenTerminal}
        />
      ),
    },
    {
      key: 'images',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <AppstoreOutlined /> 镜像
        </span>
      ),
      children: (
        <ImagesTab
          images={images}
          loading={loadingImages}
          onRefresh={fetchImages}
          onRemove={handleRemoveImage}
        />
      ),
    },
    {
      key: 'logs',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <CodeOutlined /> 日志
          {logContainer && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{logContainer.name}</Tag>}
        </span>
      ),
      children: (
        <LogsTab
          container={logContainer}
          logs={logs}
          loading={loadingLogs}
          tail={logTail}
          setTail={setLogTail}
          onRefresh={() => logContainer && fetchLogs(logContainer.id, logTail)}
          onCopy={handleCopyLogs}
        />
      ),
    },
  ]

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--color-bg-container)',
    }}>
      {/* 头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <DeploymentUnitOutlined style={{ color: 'var(--color-primary)' }} />
          Docker 管理
        </span>
        <Tooltip title="关闭">
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
        </Tooltip>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="small"
          items={tabs}
          style={{ height: '100%' }}
          tabBarStyle={{ padding: '0 10px', margin: 0 }}
          destroyInactiveTabPane={false}
        />
      </div>

      {/* 容器终端 Modal */}
      <ContainerTerminalModal
        connectionId={connectionId}
        container={terminalContainer}
        onClose={() => setTerminalContainer(null)}
      />
    </div>
  )
}

// ============ 容器 Tab ============

function ContainersTab({
  containers, loading, connectionId, showAll, setShowAll,
  refreshInterval, setRefreshInterval, paused, setPaused,
  onRefresh, onAction, onViewLogs, onOpenTerminal,
}: {
  containers: ContainerInfo[]
  loading: boolean
  connectionId: string | null
  showAll: boolean
  setShowAll: (v: boolean) => void
  refreshInterval: number
  setRefreshInterval: (v: number) => void
  paused: boolean
  setPaused: (v: boolean) => void
  onRefresh: () => void
  onAction: (c: ContainerInfo, action: DockerAction) => void
  onViewLogs: (c: ContainerInfo) => void
  onOpenTerminal: (c: ContainerInfo) => void
}) {
  if (!connectionId) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先连接服务器" style={{ marginTop: 60 }} />
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid var(--color-border)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
        </Tooltip>
        <Tooltip title={paused ? '恢复自动刷新' : '暂停自动刷新'}>
          <Button size="small" type="text"
            icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={() => setPaused(!paused)}
          />
        </Tooltip>
        <Select
          size="small"
          value={refreshInterval}
          onChange={setRefreshInterval}
          style={{ width: 90 }}
          options={[
            { label: '3秒', value: 3000 },
            { label: '5秒', value: 5000 },
            { label: '10秒', value: 10000 },
            { label: '关', value: 0 },
          ]}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginLeft: 'auto' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>显示已停止</span>
          <Switch size="small" checked={showAll} onChange={setShowAll} />
        </div>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        {loading && containers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : containers.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={showAll ? '无容器' : '无运行中容器（打开"显示已停止"查看全部）'}
            style={{ marginTop: 40 }}
          />
        ) : (
          containers.map(c => <ContainerCard key={c.id} c={c} onAction={onAction} onViewLogs={onViewLogs} onOpenTerminal={onOpenTerminal} />)
        )}
      </div>
    </div>
  )
}

function ContainerCard({
  c, onAction, onViewLogs, onOpenTerminal,
}: {
  c: ContainerInfo
  onAction: (c: ContainerInfo, action: DockerAction) => void
  onViewLogs: (c: ContainerInfo) => void
  onOpenTerminal: (c: ContainerInfo) => void
}) {
  const isRunning = c.state === 'running'
  const stateColor = isRunning ? 'success' : c.state === 'exited' ? 'default' : 'warning'

  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 4, padding: '8px 10px',
      marginBottom: 8, background: 'var(--color-bg-elevated)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tag color={stateColor} style={{ margin: 0 }}>{c.state}</Tag>
            <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.name}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
            {c.image}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
        {c.status}
        {c.ports && <span style={{ marginLeft: 8 }}>🔌 {c.ports}</span>}
      </div>
      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {isRunning ? (
          <Button size="small" type="text" icon={<StopOutlined />} onClick={() => onAction(c, 'stop')}>停止</Button>
        ) : (
          <Button size="small" type="text" icon={<CaretRightOutlined />} onClick={() => onAction(c, 'start')}>启动</Button>
        )}
        <Button size="small" type="text" icon={<RestartIcon />} onClick={() => onAction(c, 'restart')}>重启</Button>
        {isRunning && (
          <Button size="small" type="text" icon={<CodeOutlined />} onClick={() => onOpenTerminal(c)}>终端</Button>
        )}
        <Button size="small" type="text" icon={<CodeOutlined />} onClick={() => onViewLogs(c)}>日志</Button>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onAction(c, 'remove')}>删除</Button>
      </div>
    </div>
  )
}

// ============ 镜像 Tab ============

function ImagesTab({
  images, loading, onRefresh, onRemove,
}: {
  images: ImageInfo[]
  loading: boolean
  onRefresh: () => void
  onRemove: (img: ImageInfo) => void
}) {
  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
        </Tooltip>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>共 {images.length} 个镜像</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        {loading && images.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : images.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无镜像" style={{ marginTop: 40 }} />
        ) : (
          images.map(img => (
            <div key={img.id} style={{
              border: '1px solid var(--color-border)', borderRadius: 4, padding: '8px 10px',
              marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {img.repository}
                  {img.tag && img.tag !== '<none>' && (
                    <Tag style={{ marginLeft: 6, fontSize: 11 }}>{img.tag}</Tag>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {img.size} · {img.id.slice(0, 19)}
                </div>
              </div>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onRemove(img)}>
                删除
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ============ 日志 Tab ============

function LogsTab({
  container, logs, loading, tail, setTail, onRefresh, onCopy,
}: {
  container: ContainerInfo | null
  logs: string
  loading: boolean
  tail: number
  setTail: (v: number) => void
  onRefresh: () => void
  onCopy: () => void
}) {
  if (!container) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在「容器」tab 点「日志」按钮查看日志" style={{ marginTop: 60 }} />
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12 }}>{container.name}</span>
        <Select size="small" value={tail} onChange={setTail} style={{ width: 90 }}
          options={[
            { label: '100行', value: 100 },
            { label: '500行', value: 500 },
            { label: '2000行', value: 2000 },
          ]}
        />
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
        </Tooltip>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopy} style={{ marginLeft: 'auto' }}>复制</Button>
      </div>
      <pre style={{
        flex: 1, overflow: 'auto', margin: 0, padding: '8px 10px',
        fontFamily: 'Menlo, Monaco, monospace', fontSize: 12, lineHeight: 1.5,
        color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: 'var(--color-bg-elevated)',
      }}>
        {loading ? '加载中...' : (logs || '(空)')}
      </pre>
    </div>
  )
}
