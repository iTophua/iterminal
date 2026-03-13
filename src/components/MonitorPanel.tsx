import { useEffect, useState, useCallback, useRef } from 'react'
import { Progress, Spin, Empty, Select, Button, Tooltip } from 'antd'
import { CloseOutlined, ReloadOutlined, DashboardOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'

// 监控数据类型定义
interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  uptime: string
}

interface CpuInfo {
  usage: number
  cores: number
  load_avg: string
  per_core_usage: number[]
}

interface MemoryInfo {
  total: number
  used: number
  free: number
  usage_percent: number
  swap_total: number
  swap_used: number
}

interface DiskInfo {
  filesystem: string
  mount_point: string
  total: number
  used: number
  available: number
  usage_percent: number
}

interface MonitorData {
  system: SystemInfo
  cpu: CpuInfo
  memory: MemoryInfo
  disks: DiskInfo[]
}

interface MonitorPanelProps {
  visible: boolean
  connectionId: string
  onClose: () => void
}

// 格式化内存大小
const formatMemory = (mb: number): string => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}

// 监控卡片组件
const MonitorCard = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <div style={{
    background: 'rgba(45, 45, 48, 0.6)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: '#AAA', fontSize: 13 }}>
      {icon}
      <span style={{ fontWeight: 500 }}>{title}</span>
    </div>
    {children}
  </div>
)

// 信息行组件
const InfoRow = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
    <span style={{ color: '#888' }}>{label}</span>
    <span style={{ color: valueColor || '#CCC' }}>{value}</span>
  </div>
)

function MonitorPanel({ visible, connectionId, onClose }: MonitorPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MonitorData | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const [paused, setPaused] = useState(false)
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)

  // 获取监控数据
  const fetchMonitorData = useCallback(async () => {
    if (!connectionId) return

    try {
      setLoading(true)
      setError(null)
      const result = await invoke<MonitorData>('get_system_monitor', { id: connectionId })
      setData(result)
      setLastUpdateTime(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    if (visible && connectionId && !paused) {
      fetchMonitorData()

      intervalRef.current = setInterval(() => {
        fetchMonitorData()
      }, refreshInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [visible, connectionId, fetchMonitorData, refreshInterval, paused])

  // 获取进度条颜色
  const getProgressColor = (percent: number): string => {
    if (percent >= 90) return '#ff4d4f'
    if (percent >= 70) return '#faad14'
    return '#00b96b'
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: '#1E1E1E',
        borderLeft: '1px solid #3F3F46',
        zIndex: 999,
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 标题栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #3F3F46',
        background: '#252526',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#CCC', fontWeight: 500 }}>
          <DashboardOutlined />
          <span>系统监控</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select
            size="small"
            value={refreshInterval}
            onChange={(value) => setRefreshInterval(value)}
            options={[
              { value: 1000, label: '1秒' },
              { value: 3000, label: '3秒' },
              { value: 5000, label: '5秒' },
              { value: 10000, label: '10秒' },
            ]}
            style={{ width: 70 }}
            disabled={paused}
          />
          <Tooltip title={paused ? '恢复刷新' : '暂停刷新'}>
            <Button
              size="small"
              type="text"
              icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              onClick={() => setPaused(!paused)}
              style={{ color: paused ? '#00b96b' : '#888', padding: '0 4px' }}
            />
          </Tooltip>
          <Tooltip title="立即刷新">
            <ReloadOutlined
              onClick={fetchMonitorData}
              style={{ color: '#888', cursor: 'pointer', fontSize: 14 }}
            />
          </Tooltip>
          <CloseOutlined
            onClick={onClose}
            style={{ color: '#888', cursor: 'pointer', fontSize: 14 }}
          />
        </div>
      </div>
      
      {/* 内容区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && !data ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
            <Spin />
          </div>
        ) : error ? (
          <Empty description={error} style={{ marginTop: 40 }} />
        ) : data ? (
          <>
            {/* 系统信息 */}
            <MonitorCard title="系统信息" icon={<span style={{ fontSize: 14 }}>💻</span>}>
              <InfoRow label="主机名" value={data.system.hostname} />
              <InfoRow label="系统" value={data.system.os} />
              <InfoRow label="内核" value={data.system.kernel} />
              <InfoRow label="运行时间" value={data.system.uptime} />
            </MonitorCard>
            
            {/* CPU 信息 */}
            <MonitorCard title="CPU" icon={<span style={{ fontSize: 14 }}>⚡</span>}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#888', fontSize: 12 }}>总体使用率</span>
                  <span style={{ color: '#CCC', fontSize: 12 }}>{data.cpu.usage.toFixed(1)}%</span>
                </div>
                <Progress
                  percent={data.cpu.usage}
                  strokeColor={getProgressColor(data.cpu.usage)}
                  trailColor="#3F3F46"
                  showInfo={false}
                  size="small"
                />
              </div>
              
              {/* 每个核心使用率 */}
              {data.cpu.per_core_usage.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>各核心使用率</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                    {data.cpu.per_core_usage.map((usage, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: '#666', fontSize: 10, width: 24 }}>C{idx}</span>
                        <div style={{ flex: 1, height: 4, background: '#3F3F46', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${usage}%`, height: '100%', background: getProgressColor(usage), borderRadius: 2 }} />
                        </div>
                        <span style={{ color: '#888', fontSize: 10, width: 32, textAlign: 'right' }}>{usage.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <InfoRow label="核心数" value={`${data.cpu.cores} 核`} />
              <InfoRow label="负载均值" value={data.cpu.load_avg} />
            </MonitorCard>
            
            {/* 内存信息 */}
            <MonitorCard title="内存" icon={<span style={{ fontSize: 14 }}>🧠</span>}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#888', fontSize: 12 }}>内存使用</span>
                  <span style={{ color: '#CCC', fontSize: 12 }}>
                    {formatMemory(data.memory.used)} / {formatMemory(data.memory.total)}
                  </span>
                </div>
                <Progress
                  percent={data.memory.usage_percent}
                  strokeColor={getProgressColor(data.memory.usage_percent)}
                  trailColor="#3F3F46"
                  showInfo={false}
                  size="small"
                />
              </div>
              <InfoRow label="已用" value={formatMemory(data.memory.used)} />
              <InfoRow label="可用" value={formatMemory(data.memory.free)} />
              {data.memory.swap_total > 0 && (
                <InfoRow
                  label="Swap"
                  value={`${formatMemory(data.memory.swap_used)} / ${formatMemory(data.memory.swap_total)}`}
                />
              )}
            </MonitorCard>
            
            {/* 磁盘信息 */}
            <MonitorCard title="磁盘" icon={<span style={{ fontSize: 14 }}>💾</span>}>
              {data.disks.map((disk, idx) => (
                <div key={idx} style={{ marginBottom: idx < data.disks.length - 1 ? 16 : 0 }}>
                  <div style={{ color: '#00b96b', fontSize: 12, marginBottom: 6 }}>{disk.mount_point}</div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: '#888', fontSize: 12 }}>使用率</span>
                      <span style={{ color: '#CCC', fontSize: 12 }}>
                        {disk.used} GB / {disk.total} GB
                      </span>
                    </div>
                    <Progress
                      percent={disk.usage_percent}
                      strokeColor={getProgressColor(disk.usage_percent)}
                      trailColor="#3F3F46"
                      showInfo={false}
                      size="small"
                    />
                  </div>
                  <InfoRow label="可用" value={`${disk.available} GB`} />
                </div>
              ))}
            </MonitorCard>
          </>
        ) : null}
      </div>
      
      {/* 底部刷新提示 */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid #3F3F46',
        textAlign: 'center',
        color: paused ? '#faad14' : '#666',
        fontSize: 11,
        background: '#252526',
      }}>
        {paused ? (
          <span>已暂停 · {lastUpdateTime ? `最后更新: ${lastUpdateTime.toLocaleTimeString()}` : ''}</span>
        ) : (
          <span>每 {refreshInterval / 1000} 秒自动刷新</span>
        )}
      </div>
    </div>
  )
}

export default MonitorPanel