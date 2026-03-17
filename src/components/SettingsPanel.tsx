import { Modal, Select, Slider, Typography, Button, Menu, Spin, Radio, Divider, Switch, message } from 'antd'
import { useTerminalStore, type TerminalSettings } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { useState, useEffect } from 'react'
import { CodeOutlined, BgColorsOutlined, KeyOutlined, InfoCircleOutlined, SunOutlined, MoonOutlined, DesktopOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, CopyOutlined } from '@ant-design/icons'
import { terminalThemesList } from '../styles/themes/terminal-themes'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'

const { Text } = Typography

interface SettingsPanelProps {
  visible: boolean
  onClose: () => void
}

const PREVIEW_TEXT = `$ ls -la
total 48
drwxr-xr-x  12 user  staff   384 Mar 14 10:00 .
-rw-r--r--   1 user  staff  1234 Mar 14 10:00 config.json
[INFO] Server started on port 8080
user@server:~$ echo "Hello, Terminal!"
Hello, Terminal!`

type SettingCategory = 'appearance' | 'terminal' | 'mcp' | 'shortcuts' | 'about'

const SETTING_CATEGORIES = [
  { key: 'appearance', label: '外观', icon: <BgColorsOutlined /> },
  { key: 'terminal', label: '终端', icon: <CodeOutlined /> },
  { key: 'mcp', label: 'MCP', icon: <ApiOutlined /> },
  { key: 'shortcuts', label: '快捷键', icon: <KeyOutlined />, disabled: true },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined /> },
]

export default function SettingsPanel({ visible, onClose }: SettingsPanelProps) {
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  const updateTerminalSettings = useTerminalStore(state => state.updateTerminalSettings)
  const availableFonts = useTerminalStore(state => state.availableFonts)
  const fontsLoading = useTerminalStore(state => state.fontsLoading)
  
  const appThemeMode = useThemeStore(state => state.appThemeMode)
  const terminalTheme = useThemeStore(state => state.terminalTheme)
  const setAppThemeMode = useThemeStore(state => state.setAppThemeMode)
  const setTerminalTheme = useThemeStore(state => state.setTerminalTheme)
  
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('appearance')
  const [tempSettings, setTempSettings] = useState<TerminalSettings>(terminalSettings)
  const [hasTerminalChanges, setHasTerminalChanges] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem('iterminal_mcp_enabled')
    return saved ? saved === 'true' : false
  })
  const [mcpLoading, setMcpLoading] = useState(false)
  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await getVersion()
        setAppVersion(version)
      } catch (e) {
        console.error('Failed to get app version:', e)
        setAppVersion('1.0.0')
      }
    }
    fetchVersion()
  }, [])

  useEffect(() => {
    const checkMcpStatus = async () => {
      try {
        const running = await invoke<boolean>('is_api_server_running')
        const saved = localStorage.getItem('iterminal_mcp_enabled')
        const enabled = saved ? saved === 'true' : false
        if (enabled && !running) {
          await invoke('start_api_server_command')
        } else if (!enabled && running) {
          await invoke('stop_api_server')
        }
      } catch (e) {
        console.error('Failed to check MCP status:', e)
      }
    }
    checkMcpStatus()
  }, [])

  const handleMcpToggle = async (checked: boolean) => {
    setMcpLoading(true)
    try {
      if (checked) {
        await invoke('start_api_server_command')
        setMcpEnabled(true)
        localStorage.setItem('iterminal_mcp_enabled', 'true')
      } else {
        await invoke('stop_api_server')
        setMcpEnabled(false)
        localStorage.setItem('iterminal_mcp_enabled', 'false')
      }
    } catch (e) {
      message.error(`MCP 服务${checked ? '启动' : '停止'}失败: ${e}`)
    } finally {
      setMcpLoading(false)
    }
  }

  useEffect(() => {
    if (visible) {
      setTempSettings(terminalSettings)
      setHasTerminalChanges(false)
      setActiveCategory('appearance')
    }
  }, [visible, terminalSettings])

  useEffect(() => {
    if (visible && activeCategory === 'mcp') {
      invoke<boolean>('is_api_server_running')
        .then(setApiServerRunning)
        .catch(() => setApiServerRunning(false))
    }
  }, [visible, activeCategory])

  const handleFontChange = (value: TerminalSettings['fontFamily']) => {
    setTempSettings(prev => ({ ...prev, fontFamily: value }))
    setHasTerminalChanges(true)
  }

  const handleFontSizeChange = (value: number) => {
    setTempSettings(prev => ({ ...prev, fontSize: value }))
    setHasTerminalChanges(true)
  }

  const handleScrollbackChange = (value: number) => {
    setTempSettings(prev => ({ ...prev, scrollback: value }))
    setHasTerminalChanges(true)
  }

  const handleCopyOnSelectChange = (checked: boolean) => {
    setTempSettings(prev => ({ ...prev, copyOnSelect: checked }))
    setHasTerminalChanges(true)
  }

  const handleCursorStyleChange = (value: 'block' | 'underline' | 'bar') => {
    setTempSettings(prev => ({ ...prev, cursorStyle: value }))
    setHasTerminalChanges(true)
  }

  const handleCursorBlinkChange = (checked: boolean) => {
    setTempSettings(prev => ({ ...prev, cursorBlink: checked }))
    setHasTerminalChanges(true)
  }

  const handleSave = () => {
    updateTerminalSettings(tempSettings)
    onClose()
  }

  const handleClose = () => {
    onClose()
  }

  const renderTerminalSettings = () => (
    <div style={{ padding: '0 16px' }}>
      <Text strong style={{ color: 'var(--color-text)', display: 'block', marginBottom: 16 }}>
        终端设置
      </Text>

      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
          回滚缓冲区: {tempSettings.scrollback.toLocaleString()} 行
        </Text>
        <Slider
          min={100}
          max={100000}
          step={100}
          value={tempSettings.scrollback}
          onChange={handleScrollbackChange}
          marks={{ 100: '100', 10000: '1万', 50000: '5万', 100000: '10万' }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: 'var(--color-text-secondary)' }}>选中即复制</Text>
          <Switch
            checked={tempSettings.copyOnSelect}
            onChange={handleCopyOnSelectChange}
          />
        </div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          选中终端文本时自动复制到剪贴板
        </Text>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
          光标样式
        </Text>
        <Select
          value={tempSettings.cursorStyle}
          onChange={handleCursorStyleChange}
          options={[
            { value: 'block', label: '块状' },
            { value: 'underline', label: '下划线' },
            { value: 'bar', label: '竖线' },
          ]}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: 'var(--color-text-secondary)' }}>光标闪烁</Text>
          <Switch
            checked={tempSettings.cursorBlink}
            onChange={handleCursorBlinkChange}
          />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
          字体 {fontsLoading && <Spin size="small" />}
        </Text>
        <Select
          value={tempSettings.fontFamily}
          onChange={handleFontChange}
          options={availableFonts.map(font => ({
            value: font,
            label: font,
          }))}
          style={{ width: '100%' }}
          popupMatchSelectWidth
          disabled={fontsLoading || availableFonts.length === 0}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
          字体大小: {tempSettings.fontSize}px
        </Text>
        <Slider
          min={10}
          max={24}
          value={tempSettings.fontSize}
          onChange={handleFontSizeChange}
          marks={{ 10: '10', 14: '14', 18: '18', 24: '24' }}
        />
      </div>

      <div>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
          预览
        </Text>
        <div
          style={{
            background: 'var(--color-bg-container)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: 12,
            fontFamily: `"${tempSettings.fontFamily}", Menlo, Monaco, monospace`,
            fontSize: tempSettings.fontSize,
            color: 'var(--color-text)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
            overflow: 'auto',
            maxHeight: 200,
          }}
        >
          {PREVIEW_TEXT}
        </div>
      </div>
    </div>
  )

  const renderAppearanceSettings = () => (
    <div style={{ padding: '0 16px' }}>
      <Text strong style={{ color: 'var(--color-text)', display: 'block', marginBottom: 16 }}>
        外观设置
      </Text>

      <div style={{ marginBottom: 24 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 12 }}>
          应用主题
        </Text>
        <Radio.Group
          value={appThemeMode}
          onChange={(e) => setAppThemeMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="system">
            <DesktopOutlined /> 跟随系统
          </Radio.Button>
          <Radio.Button value="light">
            <SunOutlined /> 浅色
          </Radio.Button>
          <Radio.Button value="dark">
            <MoonOutlined /> 深色
          </Radio.Button>
        </Radio.Group>
      </div>

      <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

      <div>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 12 }}>
          终端主题
        </Text>
        <Select
          value={terminalTheme}
          onChange={(value) => setTerminalTheme(value)}
          options={[
            { value: null, label: '跟随应用主题' },
            ...terminalThemesList.map(theme => ({
              value: theme.id,
              label: theme.name,
            })),
          ]}
          style={{ width: '100%' }}
          allowClear={false}
        />
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
          可选择 5 个预设终端主题，或跟随应用主题自动切换
        </Text>
      </div>
    </div>
  )

  const renderMcpSettings = () => {
    const openCodeConfig = `{
  "mcp": {
    "iterminal": {
      "type": "local",
      "command": ["npx", "iterminal-mcp-server"],
      "enabled": true
    }
  }
}`
    const claudeConfig = `{
  "mcpServers": {
    "iterminal": {
      "command": "npx",
      "args": ["iterminal-mcp-server"]
    }
  }
}`

    const handleCopy = async (text: string, key: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopiedKey(key)
        setTimeout(() => setCopiedKey(null), 2000)
      } catch (e) {
        message.error('复制失败')
      }
    }

    return (
      <div style={{ padding: '0 16px' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>
              <ApiOutlined style={{ marginRight: 8 }} />MCP API 服务
            </Text>
            <Switch
              checked={mcpEnabled}
              loading={mcpLoading}
              onChange={handleMcpToggle}
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {mcpEnabled ? '服务运行中，AI 工具可通过 MCP 协议控制 SSH 连接' : '服务已停止'}
          </Text>
        </div>

        <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

        <div style={{ marginBottom: 16 }}>
          <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
            API 端点
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              background: 'var(--color-bg-spotlight)',
              padding: '8px 12px',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              flex: 1,
            }}>
              http://127.0.0.1:27149
            </div>
            {apiServerRunning ? (
              <span style={{ color: 'var(--color-success)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircleOutlined /> 正常
              </span>
            ) : (
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CloseCircleOutlined /> 未启动
              </span>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
            仅监听本地回环地址，外部网络无法访问
          </Text>
        </div>

        <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

        <div>
          <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 12 }}>
            在 AI 工具中配置
          </Text>
          
          <div style={{ marginBottom: 16 }}>
            <Text style={{ color: 'var(--color-text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
              OpenCode (推荐)
            </Text>
            <div style={{ position: 'relative' }}>
              <div style={{
                background: 'var(--color-bg-spotlight)',
                padding: '10px 12px',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                overflow: 'auto',
                whiteSpace: 'pre',
                paddingRight: 40,
              }}>
{`// ~/.config/opencode/opencode.jsonc
${openCodeConfig}`}
              </div>
              <Button
                size="small"
                icon={copiedKey === 'opencode' ? <CheckCircleOutlined /> : <CopyOutlined />}
                onClick={() => handleCopy(openCodeConfig, 'opencode')}
                style={{ position: 'absolute', top: 8, right: 8 }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Text style={{ color: 'var(--color-text-secondary)', fontSize: 13, display: 'block', marginBottom: 4 }}>
              Claude Desktop
            </Text>
            <div style={{ position: 'relative' }}>
              <div style={{
                background: 'var(--color-bg-spotlight)',
                padding: '10px 12px',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                overflow: 'auto',
                whiteSpace: 'pre',
                paddingRight: 40,
              }}>
{`// ~/Library/Application Support/Claude/claude_desktop_config.json
${claudeConfig}`}
              </div>
              <Button
                size="small"
                icon={copiedKey === 'claude' ? <CheckCircleOutlined /> : <CopyOutlined />}
                onClick={() => handleCopy(claudeConfig, 'claude')}
                style={{ position: 'absolute', top: 8, right: 8 }}
              />
            </div>
          </div>

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            配置后重启 AI 工具生效，确保 iTerminal 已启动且 MCP 服务开启
          </Text>
        </div>

        <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

        <div>
          <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 12 }}>
            可用工具 (11个)
          </Text>
          
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <div style={{ marginBottom: 12 }}>
              <b style={{ color: 'var(--color-text)' }}>连接管理</b>
              <div style={{ marginLeft: 12, marginTop: 4 }}>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_status</code> - 检查 API 服务状态</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_connect</code> - 创建 SSH 连接 (id, host, port, username, password)</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_disconnect</code> - 断开连接 (id)</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_test_connection</code> - 测试连接是否可用</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_list_connections</code> - 列出所有活跃连接</div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <b style={{ color: 'var(--color-text)' }}>命令执行</b>
              <div style={{ marginLeft: 12, marginTop: 4 }}>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_exec</code> - 在远程服务器执行命令 (id, command)</div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <b style={{ color: 'var(--color-text)' }}>系统监控</b>
              <div style={{ marginLeft: 12, marginTop: 4 }}>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_monitor</code> - 获取 CPU/内存/磁盘使用情况 (id)</div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <b style={{ color: 'var(--color-text)' }}>文件操作</b>
              <div style={{ marginLeft: 12, marginTop: 4 }}>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_list_dir</code> - 列出目录内容 (id, path)</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_mkdir</code> - 创建目录 (id, path)</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_rm</code> - 删除文件 (id, path)</div>
                <div>• <code style={{ background: 'var(--color-bg-spotlight)', padding: '1px 4px', borderRadius: 3 }}>iter_rename</code> - 重命名文件/目录 (id, old_path, new_path)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeCategory) {
      case 'appearance':
        return renderAppearanceSettings()
      case 'terminal':
        return renderTerminalSettings()
      case 'mcp':
        return renderMcpSettings()
      case 'about':
        return (
          <div style={{ padding: '0 16px' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🖥️</div>
              <Text strong style={{ fontSize: 20, color: 'var(--color-text)' }}>iTerminal</Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>v{appVersion || '...'}</Text>
            </div>

            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div style={{ marginBottom: 16 }}>
              <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
                一款现代化的 SSH 连接管理工具，支持多会话终端、文件管理、系统监控。
              </Text>
            </div>

            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div style={{ marginBottom: 16 }}>
              <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                技术栈
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Tauri 2 + React 19 + TypeScript + Rust + russh
              </Text>
            </div>

            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div style={{ marginBottom: 16 }}>
              <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                开源协议
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>MIT License</Text>
            </div>

            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div>
              <Text style={{ color: 'var(--color-text)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                相关链接
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a
                  href="https://github.com/iTophua/iterminal"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-primary)', fontSize: 13 }}
                >
                  🔗 GitHub 仓库
                </a>
                <a
                  href="https://github.com/iTophua/iterminal/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-primary)', fontSize: 13 }}
                >
                  🐛 问题反馈
                </a>
              </div>
            </div>
          </div>
        )
      default:
        return (
          <div style={{ padding: '0 16px', textAlign: 'center', color: 'var(--color-text-tertiary)', marginTop: 40 }}>
            该功能正在开发中...
          </div>
        )
    }
  }

  const showFooter = activeCategory === 'terminal'

  return (
    <Modal
      title="系统设置"
      open={visible}
      onCancel={handleClose}
      footer={showFooter ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" onClick={handleSave} disabled={!hasTerminalChanges} style={{ background: 'var(--color-primary)' }}>
            保存
          </Button>
        </div>
      ) : null}
      width={600}
      styles={{
        body: { padding: 0 },
        header: { borderBottom: '1px solid var(--color-border)' },
      }}
    >
      <div style={{ display: 'flex', minHeight: 400 }}>
        <div style={{
          width: 140,
          borderRight: '1px solid var(--color-border)',
          padding: '12px 0',
          background: 'var(--color-bg-container)',
        }}>
          <Menu
            mode="vertical"
            selectedKeys={[activeCategory]}
            onClick={(e) => setActiveCategory(e.key as SettingCategory)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text)',
            }}
            items={SETTING_CATEGORIES.map(item => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              disabled: item.disabled,
            }))}
          />
        </div>
        <div style={{ flex: 1, padding: '16px 0', background: 'var(--color-bg-elevated)', maxHeight: 450, overflow: 'auto' }}>
          {renderContent()}
        </div>
      </div>
    </Modal>
  )
}