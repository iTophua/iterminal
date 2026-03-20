import { useEffect, useState, useCallback, useRef } from 'react'
import { Progress, Spin, Empty, Select, Button, Tooltip, Tabs, Table, App, InputNumber, Switch, Badge } from 'antd'
import type { TabsProps } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  DashboardOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  WifiOutlined,
  AppstoreOutlined,
  StopOutlined,
  SettingOutlined,
  AlertOutlined,
} from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'

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

interface NetworkInterface {
  name: string
  rx_bytes: number
  rx_packets: number
  rx_errors: number
  tx_bytes: number
  tx_packets: number
  tx_errors: number
}

interface NetworkStats {
  interfaces: NetworkInterface[]
}

interface ProcessInfo {
  pid: number
  user: string
  cpu: number
  mem: number
  vsz: number
  rss: number
  command: string
}

interface HistoryPoint {
  time: number
  cpu: number
  memory: number
}

interface AlertThresholds {
  cpu: number
  memory: number
  disk: number
  enabled: boolean
}

interface MonitorPanelProps {
  visible: boolean
  connectionId: string
  onClose: () => void
}

const MAX_HISTORY_POINTS = 60

const formatMemory = (mb: number): string => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb} MB`
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }
  return `${bytes} B`
}

const MonitorCard = ({ title, icon, children, alert }: { title: string; icon: React.ReactNode; children: React.ReactNode; alert?: boolean }) => (
  <div
    style={{
      background: alert ? 'rgba(255, 77, 79, 0.1)' : 'var(--color-bg-spotlight)',
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
      border: alert ? '1px solid var(--color-error)' : 'none',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        color: alert ? 'var(--color-error)' : 'var(--color-text-secondary)',
        fontSize: 13,
      }}
    >
      {icon}
      <span style={{ fontWeight: 500 }}>{title}</span>
      {alert && <AlertOutlined style={{ marginLeft: 'auto' }} />}
    </div>
    {children}
  </div>
)

const InfoRow = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
    <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
    <span style={{ color: valueColor || 'var(--color-text)' }}>{value}</span>
  </div>
)

const SimpleChart = ({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) => {
  if (data.length < 2) return null

  const max = Math.max(...data, 100)
  const width = 100
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - (value / max) * height
    return `${x},${y}`
  })

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points.join(' ')}
      />
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - (data[data.length - 1] / max) * height}
          r="2"
          fill={color}
        />
      )}
    </svg>
  )
}

function MonitorPanel({ visible, connectionId, onClose }: MonitorPanelProps) {
  const { message, modal } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MonitorData | null>(null)
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const [paused, setPaused] = useState(false)
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const [activeTab, setActiveTab] = useState('system')
  const [processLoading, setProcessLoading] = useState(false)

  const historyRef = useRef<HistoryPoint[]>([])
  const prevNetworkRef = useRef<Map<string, { rx: number; tx: number; time: number }>>(new Map())
  const [networkSpeed, setNetworkSpeed] = useState<Map<string, { rxSpeed: number; txSpeed: number }>>(new Map())

  const [thresholds, setThresholds] = useState<AlertThresholds>(() => {
    const saved = localStorage.getItem('iterminal_alert_thresholds')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        return { cpu: 90, memory: 90, disk: 90, enabled: true }
      }
    }
    return { cpu: 90, memory: 90, disk: 90, enabled: true }
  })

  const [alerts, setAlerts] = useState<{ cpu: boolean; memory: boolean; disk: boolean }>({
    cpu: false,
    memory: false,
    disk: false,
  })

  useEffect(() => {
    localStorage.setItem('iterminal_alert_thresholds', JSON.stringify(thresholds))
  }, [thresholds])

  const fetchMonitorData = useCallback(async () => {
    if (!connectionId) return

    try {
      setLoading(true)
      setError(null)
      const result = await invoke<MonitorData>('get_system_monitor', { id: connectionId })
      setData(result)
      setLastUpdateTime(new Date())

      historyRef.current.push({
        time: Date.now(),
        cpu: result.cpu.usage,
        memory: result.memory.usage_percent,
      })
      if (historyRef.current.length > MAX_HISTORY_POINTS) {
        historyRef.current.shift()
      }

      if (thresholds.enabled) {
        setAlerts(prevAlerts => {
          const newAlerts = {
            cpu: result.cpu.usage >= thresholds.cpu,
            memory: result.memory.usage_percent >= thresholds.memory,
            disk: result.disks.some((d) => d.usage_percent >= thresholds.disk),
          }

          if (newAlerts.cpu && !prevAlerts.cpu) {
            message.warning(`CPU 使用率超过 ${thresholds.cpu}%`)
          }
          if (newAlerts.memory && !prevAlerts.memory) {
            message.warning(`内存使用率超过 ${thresholds.memory}%`)
          }
          if (newAlerts.disk && !prevAlerts.disk) {
            message.warning(`磁盘使用率超过 ${thresholds.disk}%`)
          }

          return newAlerts
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [connectionId, thresholds, message])

  const fetchNetworkStats = useCallback(async () => {
    if (!connectionId) return

    try {
      const result = await invoke<NetworkStats>('get_network_stats', { id: connectionId })
      setNetworkStats(result)

      const now = Date.now()
      const newSpeeds = new Map<string, { rxSpeed: number; txSpeed: number }>()

      result.interfaces.forEach((iface) => {
        const prev = prevNetworkRef.current.get(iface.name)
        if (prev) {
          const timeDiff = (now - prev.time) / 1000
          const rxDiff = iface.rx_bytes - prev.rx
          const txDiff = iface.tx_bytes - prev.tx
          newSpeeds.set(iface.name, {
            rxSpeed: timeDiff > 0 ? rxDiff / timeDiff : 0,
            txSpeed: timeDiff > 0 ? txDiff / timeDiff : 0,
          })
        }
        prevNetworkRef.current.set(iface.name, {
          rx: iface.rx_bytes,
          tx: iface.tx_bytes,
          time: now,
        })
      })

      setNetworkSpeed(newSpeeds)
    } catch (err) {
      console.error('Failed to fetch network stats:', err)
    }
  }, [connectionId])

  const fetchProcesses = useCallback(async () => {
    if (!connectionId) return

    try {
      setProcessLoading(true)
      const result = await invoke<ProcessInfo[]>('list_processes', { id: connectionId })
      setProcesses(result)
    } catch (err) {
      console.error('Failed to fetch processes:', err)
    } finally {
      setProcessLoading(false)
    }
  }, [connectionId])

  const handleKillProcess = useCallback(
    async (pid: number) => {
      modal.confirm({
        title: '确认终止进程',
        content: `确定要终止进程 PID: ${pid} 吗？`,
        okText: '终止',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await invoke('kill_process', { id: connectionId, pid, signal: 'TERM' })
            message.success(`进程 ${pid} 已终止`)
            fetchProcesses()
          } catch (err) {
            message.error(`终止进程失败: ${err}`)
          }
        },
      })
    },
    [connectionId, fetchProcesses, message, modal]
  )

  useEffect(() => {
    if (visible && connectionId && !paused) {
      const initialTimer = setTimeout(() => {
        fetchMonitorData()
        fetchNetworkStats()

        intervalRef.current = setInterval(() => {
          fetchMonitorData()
          fetchNetworkStats()
        }, refreshInterval)
      }, 200)

      return () => {
        clearTimeout(initialTimer)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [visible, connectionId, fetchMonitorData, fetchNetworkStats, refreshInterval, paused])

  useEffect(() => {
    if (visible && connectionId && activeTab === 'processes') {
      fetchProcesses()
    }
  }, [visible, connectionId, activeTab, fetchProcesses])

  useEffect(() => {
    if (!visible) {
      historyRef.current = []
      prevNetworkRef.current.clear()
      setNetworkSpeed(new Map())
    }
  }, [visible, connectionId])

  const getProgressColor = (percent: number): string => {
    if (percent >= 90) return 'var(--color-error)'
    if (percent >= 70) return 'var(--color-warning)'
    return 'var(--color-success)'
  }

  const cpuHistory = historyRef.current.map((p) => p.cpu)
  const memoryHistory = historyRef.current.map((p) => p.memory)

  const systemTab = (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
          <Spin />
        </div>
      ) : error ? (
        <Empty description={error} style={{ marginTop: 40 }} />
      ) : data ? (
        <>
          <MonitorCard title="系统信息" icon={<span style={{ fontSize: 14 }}>💻</span>}>
            <InfoRow label="主机名" value={data.system.hostname} />
            <InfoRow label="系统" value={data.system.os} />
            <InfoRow label="内核" value={data.system.kernel} />
            <InfoRow label="运行时间" value={data.system.uptime} />
          </MonitorCard>

          <MonitorCard title="CPU" icon={<span style={{ fontSize: 14 }}>⚡</span>} alert={alerts.cpu}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>总体使用率</span>
                <span style={{ color: alerts.cpu ? 'var(--color-error)' : 'var(--color-text)', fontSize: 12, fontWeight: 500 }}>
                  {data.cpu.usage.toFixed(1)}%
                </span>
              </div>
              <Progress
                percent={data.cpu.usage}
                strokeColor={getProgressColor(data.cpu.usage)}
                trailColor="var(--color-border)"
                showInfo={false}
                size="small"
              />
            </div>

            {cpuHistory.length > 1 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginBottom: 4 }}>历史趋势</div>
                <SimpleChart data={cpuHistory} color={getProgressColor(data.cpu.usage)} height={30} />
              </div>
            )}

            {data.cpu.per_core_usage.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12, marginBottom: 6 }}>各核心使用率</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                  {data.cpu.per_core_usage.map((usage, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--color-text-quaternary)', fontSize: 10, width: 24 }}>C{idx}</span>
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: 'var(--color-border)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${usage}%`,
                            height: '100%',
                            background: getProgressColor(usage),
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, width: 32, textAlign: 'right' }}>
                        {usage.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <InfoRow label="核心数" value={`${data.cpu.cores} 核`} />
            <InfoRow label="负载均值" value={data.cpu.load_avg} />
          </MonitorCard>

          <MonitorCard title="内存" icon={<span style={{ fontSize: 14 }}>🧠</span>} alert={alerts.memory}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>内存使用</span>
                <span style={{ color: alerts.memory ? 'var(--color-error)' : 'var(--color-text)', fontSize: 12, fontWeight: 500 }}>
                  {formatMemory(data.memory.used)} / {formatMemory(data.memory.total)}
                </span>
              </div>
              <Progress
                percent={data.memory.usage_percent}
                strokeColor={getProgressColor(data.memory.usage_percent)}
                trailColor="var(--color-border)"
                showInfo={false}
                size="small"
              />
            </div>

            {memoryHistory.length > 1 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginBottom: 4 }}>历史趋势</div>
                <SimpleChart data={memoryHistory} color={getProgressColor(data.memory.usage_percent)} height={30} />
              </div>
            )}

            <InfoRow label="已用" value={formatMemory(data.memory.used)} />
            <InfoRow label="可用" value={formatMemory(data.memory.free)} />
            {data.memory.swap_total > 0 && (
              <InfoRow
                label="Swap"
                value={`${formatMemory(data.memory.swap_used)} / ${formatMemory(data.memory.swap_total)}`}
              />
            )}
          </MonitorCard>

          <MonitorCard title="磁盘" icon={<span style={{ fontSize: 14 }}>💾</span>} alert={alerts.disk}>
            {data.disks.map((disk, idx) => (
              <div key={idx} style={{ marginBottom: idx < data.disks.length - 1 ? 16 : 0 }}>
                <div style={{ color: 'var(--color-primary)', fontSize: 12, marginBottom: 6 }}>{disk.mount_point}</div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>使用率</span>
                    <span
                      style={{
                        color: disk.usage_percent >= thresholds.disk ? 'var(--color-error)' : 'var(--color-text)',
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {disk.used} GB / {disk.total} GB
                    </span>
                  </div>
                  <Progress
                    percent={disk.usage_percent}
                    strokeColor={getProgressColor(disk.usage_percent)}
                    trailColor="var(--color-border)"
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
  )

  const networkTab = (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      {!networkStats || networkStats.interfaces.length === 0 ? (
        <Empty description="无网络接口" style={{ marginTop: 40 }} />
      ) : (
        networkStats.interfaces.map((iface, idx) => {
          const speed = networkSpeed.get(iface.name)
          return (
            <MonitorCard key={idx} title={iface.name} icon={<WifiOutlined />}>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginBottom: 4 }}>接收 (RX)</div>
                <InfoRow label="流量" value={formatBytes(iface.rx_bytes)} />
                {speed && <InfoRow label="速率" value={`${formatBytes(speed.rxSpeed)}/s`} valueColor="var(--color-primary)" />}
                <InfoRow label="数据包" value={iface.rx_packets.toLocaleString()} />
                {iface.rx_errors > 0 && (
                  <InfoRow label="错误" value={iface.rx_errors.toLocaleString()} valueColor="var(--color-error)" />
                )}
              </div>
              <div>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginBottom: 4 }}>发送 (TX)</div>
                <InfoRow label="流量" value={formatBytes(iface.tx_bytes)} />
                {speed && <InfoRow label="速率" value={`${formatBytes(speed.txSpeed)}/s`} valueColor="var(--color-primary)" />}
                <InfoRow label="数据包" value={iface.tx_packets.toLocaleString()} />
                {iface.tx_errors > 0 && (
                  <InfoRow label="错误" value={iface.tx_errors.toLocaleString()} valueColor="var(--color-error)" />
                )}
              </div>
            </MonitorCard>
          )
        })
      )}
    </div>
  )

  const processColumns = [
    {
      title: 'PID',
      dataIndex: 'pid',
      key: 'pid',
      width: 60,
      render: (pid: number) => <span style={{ color: 'var(--color-primary)' }}>{pid}</span>,
    },
    {
      title: '用户',
      dataIndex: 'user',
      key: 'user',
      width: 70,
      ellipsis: true,
    },
    {
      title: 'CPU%',
      dataIndex: 'cpu',
      key: 'cpu',
      width: 60,
      render: (cpu: number) => (
        <span style={{ color: cpu > 50 ? 'var(--color-warning)' : 'var(--color-text)' }}>{cpu.toFixed(1)}</span>
      ),
    },
    {
      title: 'MEM%',
      dataIndex: 'mem',
      key: 'mem',
      width: 60,
      render: (mem: number) => (
        <span style={{ color: mem > 50 ? 'var(--color-warning)' : 'var(--color-text)' }}>{mem.toFixed(1)}</span>
      ),
    },
    {
      title: '命令',
      dataIndex: 'command',
      key: 'command',
      ellipsis: true,
      render: (cmd: string) => (
        <Tooltip title={cmd}>
          <span style={{ fontSize: 11 }}>{cmd}</span>
        </Tooltip>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 30,
      render: (_: unknown, record: ProcessInfo) => (
        <Tooltip title="终止进程">
          <StopOutlined
            style={{ color: 'var(--color-error)', cursor: 'pointer', fontSize: 12 }}
            onClick={() => handleKillProcess(record.pid)}
          />
        </Tooltip>
      ),
    },
  ]

  const processesTab = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={fetchProcesses} loading={processLoading}>
          刷新
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table
          dataSource={processes}
          columns={processColumns}
          rowKey="pid"
          size="small"
          pagination={false}
          loading={processLoading}
          scroll={{ y: 'calc(100vh - 200px)' }}
          style={{
            background: 'var(--color-bg-container)',
          }}
        />
      </div>
    </div>
  )

  const settingsTab = (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <MonitorCard title="告警设置" icon={<AlertOutlined />}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: 'var(--color-text)', fontSize: 12 }}>启用告警</span>
            <Switch
              size="small"
              checked={thresholds.enabled}
              onChange={(checked) => setThresholds((t) => ({ ...t, enabled: checked }))}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>CPU 告警阈值 (%)</span>
            <InputNumber
              size="small"
              min={50}
              max={100}
              value={thresholds.cpu}
              onChange={(v) => setThresholds((t) => ({ ...t, cpu: v || 90 }))}
              style={{ width: 70 }}
              disabled={!thresholds.enabled}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>内存告警阈值 (%)</span>
            <InputNumber
              size="small"
              min={50}
              max={100}
              value={thresholds.memory}
              onChange={(v) => setThresholds((t) => ({ ...t, memory: v || 90 }))}
              style={{ width: 70 }}
              disabled={!thresholds.enabled}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>磁盘告警阈值 (%)</span>
            <InputNumber
              size="small"
              min={50}
              max={100}
              value={thresholds.disk}
              onChange={(v) => setThresholds((t) => ({ ...t, disk: v || 90 }))}
              style={{ width: 70 }}
              disabled={!thresholds.enabled}
            />
          </div>
        </div>
      </MonitorCard>

      <div style={{ color: 'var(--color-text-quaternary)', fontSize: 11 }}>
        当资源使用率超过阈值时，会显示告警标识并发送通知。
      </div>
    </div>
  )

  const hasAlerts = alerts.cpu || alerts.memory || alerts.disk

  const items: TabsProps['items'] = [
    {
      key: 'system',
      label: (
        <span>
          系统
          {hasAlerts && thresholds.enabled && (
            <Badge status="error" style={{ marginLeft: 4 }} />
          )}
        </span>
      ),
      icon: <DashboardOutlined />,
      children: systemTab,
    },
    {
      key: 'network',
      label: '网络',
      icon: <WifiOutlined />,
      children: networkTab,
    },
    {
      key: 'processes',
      label: '进程',
      icon: <AppstoreOutlined />,
      children: processesTab,
    },
    {
      key: 'settings',
      label: '设置',
      icon: <SettingOutlined />,
      children: settingsTab,
    },
  ]

  return (
    <div
      style={{
        width: 360,
        height: '100%',
        background: 'var(--color-bg-container)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)', fontWeight: 500 }}>
          <DashboardOutlined />
          <span>系统监控</span>
          {hasAlerts && thresholds.enabled && (
            <Badge status="error" />
          )}
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
              style={{
                color: paused ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                padding: '0 4px',
              }}
            />
          </Tooltip>
          <Tooltip title="立即刷新">
            <ReloadOutlined
              onClick={() => {
                fetchMonitorData()
                fetchNetworkStats()
                if (activeTab === 'processes') fetchProcesses()
              }}
              style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 14 }}
            />
          </Tooltip>
          <CloseOutlined
            onClick={onClose}
            style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 14 }}
          />
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        size="small"
        style={{ flex: 1, overflow: 'hidden' }}
        tabBarStyle={{
          marginBottom: 0,
          padding: '0 12px',
          background: 'var(--color-bg-elevated)',
        }}
      />

      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
          color: paused ? 'var(--color-warning)' : 'var(--color-text-quaternary)',
          fontSize: 11,
          background: 'var(--color-bg-elevated)',
        }}
      >
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