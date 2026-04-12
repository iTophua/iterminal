import { Modal, Select, Slider, Typography, Button, Menu, Spin, Radio, Divider, Switch, message, Input, Tag, Space, Tooltip } from 'antd'
import { useTerminalStore, type TerminalSettings, type ShortcutSettings, formatShortcutForDisplay } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { useLicenseStore } from '../stores/licenseStore'
import type { TerminalThemeName } from '../types/theme'
import { useState, useEffect, useCallback } from 'react'
import { CodeOutlined, BgColorsOutlined, KeyOutlined, InfoCircleOutlined, SunOutlined, MoonOutlined, DesktopOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, CopyOutlined, CrownOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons'
import { terminalThemesList } from '../styles/themes/terminal-themes'
import { themeList } from '../styles/themes/app-themes'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { STORAGE_KEYS, API_CONFIG } from '../config/constants'

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

type SettingCategory = 'appearance' | 'terminal' | 'mcp' | 'license' | 'shortcuts' | 'about'

const SETTING_CATEGORIES = [
  { key: 'appearance', label: '外观', icon: <BgColorsOutlined /> },
  { key: 'terminal', label: '终端', icon: <CodeOutlined /> },
  { key: 'mcp', label: 'MCP', icon: <ApiOutlined /> },
  { key: 'license', label: 'License', icon: <CrownOutlined /> },
  { key: 'shortcuts', label: '快捷键', icon: <KeyOutlined /> },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined /> },
]

export default function SettingsPanel({ visible, onClose }: SettingsPanelProps) {
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  const updateTerminalSettings = useTerminalStore(state => state.updateTerminalSettings)
  const shortcutSettings = useTerminalStore(state => state.shortcutSettings)
  const updateShortcutSettings = useTerminalStore(state => state.updateShortcutSettings)
  const resetShortcutSettings = useTerminalStore(state => state.resetShortcutSettings)
  const availableFonts = useTerminalStore(state => state.availableFonts)
  const fontsLoading = useTerminalStore(state => state.fontsLoading)
  const reloadFonts = useTerminalStore(state => state.reloadFonts)
  
  const appThemeMode = useThemeStore(state => state.appThemeMode)
  const selectedTheme = useThemeStore(state => state.selectedTheme)
  const terminalTheme = useThemeStore(state => state.terminalTheme)
  const setAppThemeMode = useThemeStore(state => state.setAppThemeMode)
  const setSelectedTheme = useThemeStore(state => state.setSelectedTheme)
  const setTerminalTheme = useThemeStore(state => state.setTerminalTheme)
  
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(() => {
    const saved = localStorage.getItem('iterminal_settings_category')
    return (saved as SettingCategory) || 'appearance'
  })
  
  const handleCategoryChange = useCallback((category: SettingCategory) => {
    setActiveCategory(category)
    localStorage.setItem('iterminal_settings_category', category)
  }, [])
  const [tempSettings, setTempSettings] = useState<TerminalSettings>(terminalSettings)
  const [hasTerminalChanges, setHasTerminalChanges] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MCP_ENABLED)
    return saved ? saved === 'true' : false
  })
  const [mcpLoading, setMcpLoading] = useState(false)
  const [apiServerRunning, setApiServerRunning] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string>('')
  
  const licenseInfo = useLicenseStore(state => state.licenseInfo)
  const licenseLoading = useLicenseStore(state => state.loading)
  const fetchLicense = useLicenseStore(state => state.fetchLicense)
  const verifyLicense = useLicenseStore(state => state.verifyLicense)
  const [licenseKey, setLicenseKey] = useState('')
  const [editingShortcutKey, setEditingShortcutKey] = useState<string | null>(null)
  const [tempShortcutKey, setTempShortcutKey] = useState<string>('')

  useEffect(() => {
    if (!editingShortcutKey) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      if (e.key === 'Escape') {
        setEditingShortcutKey(null)
        setTempShortcutKey('')
        return
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        updateShortcutSettings({ [editingShortcutKey as keyof ShortcutSettings]: '' })
        setEditingShortcutKey(null)
        setTempShortcutKey('')
        return
      }
      
      if (e.key === 'Enter') {
        updateShortcutSettings({ [editingShortcutKey as keyof ShortcutSettings]: tempShortcutKey })
        setEditingShortcutKey(null)
        setTempShortcutKey('')
        return
      }
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const parts: string[] = []
      
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (isMac && e.metaKey) parts.push('Cmd')
      if (!isMac && e.metaKey) parts.push('Meta')
      
      const modifierKeys = ['Control', 'Shift', 'Alt', 'Meta']
      
      if (!modifierKeys.includes(e.key)) {
        const codeToKey: Record<string, string> = {
          'Space': 'Space',
          'ArrowUp': 'Up',
          'ArrowDown': 'Down',
          'ArrowLeft': 'Left',
          'ArrowRight': 'Right',
          'Enter': 'Enter',
          'Backspace': 'Backspace',
          'Delete': 'Delete',
          'Tab': 'Tab',
        }
        
        let keyName = e.code
        if (keyName.startsWith('Key')) {
          keyName = keyName.slice(3)
        } else if (keyName.startsWith('Digit')) {
          keyName = keyName.slice(5)
        } else if (keyName.startsWith('Numpad')) {
          keyName = 'Num' + keyName.slice(6)
        } else if (codeToKey[keyName]) {
          keyName = codeToKey[keyName]
        }
        
        parts.push(keyName.toUpperCase())
      }
      
      setTempShortcutKey(parts.join('+'))
    }

    const handleBlur = () => {
      if (editingShortcutKey) {
        updateShortcutSettings({ [editingShortcutKey as keyof ShortcutSettings]: tempShortcutKey })
      }
      setEditingShortcutKey(null)
      setTempShortcutKey('')
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('mousedown', handleBlur, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('mousedown', handleBlur, true)
    }
  }, [editingShortcutKey, tempShortcutKey, updateShortcutSettings])

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
        const saved = localStorage.getItem(STORAGE_KEYS.MCP_ENABLED)
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
        localStorage.setItem(STORAGE_KEYS.MCP_ENABLED, 'true')
      } else {
        await invoke('stop_api_server')
        setMcpEnabled(false)
        localStorage.setItem(STORAGE_KEYS.MCP_ENABLED, 'false')
      }
      // 通知其他组件 MCP 状态变更
      window.dispatchEvent(new CustomEvent('mcp-status-change', { detail: checked }))
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
      fetchLicense()
    }
  }, [visible, terminalSettings, fetchLicense])

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
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={tempSettings.fontFamily}
            onChange={handleFontChange}
            options={availableFonts.map(font => ({
              value: font,
              label: font,
            }))}
            style={{ flex: 1 }}
            popupMatchSelectWidth
            disabled={fontsLoading || availableFonts.length === 0}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
          <Tooltip title="重新加载字体列表">
            <Button
              icon={<ReloadOutlined />}
              loading={fontsLoading}
              onClick={() => reloadFonts()}
            />
          </Tooltip>
        </div>
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
          配色主题
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {themeList.map((theme) => {
            const isActive = selectedTheme === theme.id
            const lightColor = theme.colors.light['--color-primary']
            const darkColor = theme.colors.dark['--color-primary']
            const lightBg = theme.colors.light['--color-bg-base']
            const darkBg = theme.colors.dark['--color-bg-base']

            return (
              <div
                key={theme.id}
                onClick={() => setSelectedTheme(theme.id)}
                style={{
                  cursor: 'pointer',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: isActive
                    ? 'var(--color-bg-spotlight)'
                    : 'transparent',
                  border: `2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border-secondary)'}`,
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: isActive ? 'translateY(-2px)' : 'none',
                  boxShadow: isActive
                    ? `0 4px 12px ${lightColor}30`
                    : '0 1px 3px rgba(0,0,0,0.08)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = 'translateY(-3px)'
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'
                  }
                }}
              >
                {/* 主题预览缩略图 */}
                <div
                  style={{
                    position: 'relative',
                    height: 48,
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  {/* 亮色模式预览 */}
                  <div
                    style={{
                      flex: 1,
                      background: lightBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: lightColor,
                        boxShadow: `0 0 8px ${lightColor}60`,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: 4,
                        top: 4,
                        fontSize: 8,
                        color: theme.colors.light['--color-text-tertiary'],
                      }}
                    >
                      <SunOutlined />
                    </div>
                  </div>

                  {/* 分隔线 */}
                  <div style={{ width: 1, background: 'var(--color-border)' }} />

                  {/* 暗色模式预览 */}
                  <div
                    style={{
                      flex: 1,
                      background: darkBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: darkColor,
                        boxShadow: `0 0 8px ${darkColor}60`,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        right: 4,
                        top: 4,
                        fontSize: 8,
                        color: theme.colors.dark['--color-text-tertiary'],
                      }}
                    >
                      <MoonOutlined />
                    </div>
                  </div>

                  {/* 激活状态覆盖层 */}
                  {isActive && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `${lightColor}15`,
                      }}
                    >
                      <CheckOutlined
                        style={{
                          color: 'var(--color-primary)',
                          fontSize: 20,
                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 主题名称 */}
                <div style={{ padding: '6px 4px', textAlign: 'center' }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                      display: 'block',
                      lineHeight: 1.3,
                    }}
                  >
                    {theme.name}
                  </Text>
                </div>
              </div>
            )
          })}
        </div>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 10, display: 'block' }}>
          {(() => {
            const t = themeList.find(th => th.id === selectedTheme)
            return t?.description || ''
          })()}
        </Text>
      </div>

      <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

      <div style={{ marginBottom: 24 }}>
        <Text style={{ color: 'var(--color-text-secondary)', display: 'block', marginBottom: 12 }}>
          明暗模式
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: 'var(--color-text-secondary)' }}>
            终端主题
          </Text>
          <Tooltip title="跟随应用主题时，终端颜色会自动匹配当前应用主题">
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', cursor: 'help' }}>
              什么是跟随模式？
            </span>
          </Tooltip>
        </div>

        {/* 跟随应用主题开关 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            marginBottom: 12,
            background: terminalTheme === null ? 'var(--color-bg-spotlight)' : 'var(--color-bg-container)',
            border: `1px solid ${terminalTheme === null ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 8,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onClick={() => setTerminalTheme(null)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircleOutlined
              style={{
                color: terminalTheme === null ? 'var(--color-primary)' : 'var(--color-text-quaternary)',
                fontSize: 16,
              }}
            />
            <div>
              <Text style={{
                color: terminalTheme === null ? 'var(--color-primary)' : 'var(--color-text)',
                fontWeight: terminalTheme === null ? 600 : 400,
              }}>
                跟随应用主题
              </Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                终端颜色自动匹配当前应用主题
              </Text>
            </div>
          </div>
          {terminalTheme === null && (
            <Tag color="green" style={{ margin: 0 }}>当前</Tag>
          )}
        </div>

        <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12, display: 'block', marginBottom: 8 }}>
          或选择固定主题
        </Text>

        {/* 终端主题网格选择 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 8 }}>
          {terminalThemesList.map((theme) => {
            const isActive = terminalTheme === theme.id
            const themeColors = theme.colors
            return (
              <div
                key={theme.id}
                onClick={() => setTerminalTheme(theme.id)}
                style={{
                  cursor: 'pointer',
                  borderRadius: 8,
                  padding: '8px 6px',
                  background: isActive
                    ? 'var(--color-bg-spotlight)'
                    : 'var(--color-bg-container)',
                  border: `2px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border-secondary)'}`,
                  transition: 'all 0.2s ease',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = 'var(--color-text-quaternary)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = 'var(--color-border-secondary)'
                  }
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    margin: '0 auto 4px',
                    background: themeColors.background,
                    border: `1px solid ${themeColors.foreground}40`,
                    position: 'relative',
                    boxShadow: isActive
                      ? `0 2px 8px ${themeColors.foreground}40`
                      : '0 1px 3px rgba(0,0,0,0.15)',
                    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 4,
                      borderRadius: 3,
                      background: `linear-gradient(135deg, ${themeColors.green} 0%, ${themeColors.blue} 100%)`,
                      opacity: 0.6,
                    }}
                  />
                  {isActive && (
                    <CheckOutlined
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: '#fff',
                        fontSize: 14,
                        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                        zIndex: 1,
                      }}
                    />
                  )}
                </div>
                <Text
                  style={{
                    fontSize: 10,
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    fontWeight: isActive ? 600 : 400,
                    display: 'block',
                    lineHeight: 1.3,
                  }}
                >
                  {theme.name}
                </Text>
              </div>
            )
          })}
        </div>

        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {terminalTheme
            ? terminalThemesList.find(t => t.id === terminalTheme)?.description || ''
            : '终端主题将跟随应用主题自动切换'
          }
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
              {API_CONFIG.BASE_URL}
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

  const renderLicenseSettings = () => {
    const currentType = licenseInfo?.license_type || 'Free'
    const isPaid = currentType !== 'Free'
    const isEnterprise = currentType === 'Enterprise'
    
    const licenseTypeLabels: Record<string, string> = {
      Free: '免费版',
      Personal: '个人版',
      Professional: '专业版',
      Enterprise: '企业版',
    }

    const licenseFeatures = {
      Free: ['SSH 连接管理', 'SFTP 文件传输', '系统监控', '最多 3 个连接'],
      Personal: ['无限连接', 'AI 日志分析', '命令片段库', '终端主题', '优先支持'],
      Professional: ['无限连接', 'AI 日志分析', '命令片段库', '终端主题', '团队协作', '审计日志', '私有部署支持'],
      Enterprise: ['所有功能', '无限连接', '专属客服', '定制开发'],
    }

    const handleActivate = async () => {
      if (!licenseKey.trim()) {
        message.error('请输入 License Key')
        return
      }
      const success = await verifyLicense(licenseKey.trim())
      if (success) {
        message.success('激活成功！')
        setLicenseKey('')
      }
    }

    return (
      <div style={{ padding: '0 16px' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <CrownOutlined style={{ fontSize: 24, color: isPaid ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }} />
            <div>
              <Text strong style={{ fontSize: 18, color: 'var(--color-text)' }}>
                {licenseTypeLabels[currentType]}
              </Text>
              {isPaid && licenseInfo?.expires_at && (
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  到期时间：{licenseInfo.expires_at}
                </Text>
              )}
            </div>
          </div>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {licenseFeatures[currentType].map(feature => (
              <Tag key={feature} style={{ margin: 0 }}>
                <CheckCircleOutlined style={{ color: 'var(--color-success)', marginRight: 4 }} />
                {feature}
              </Tag>
            ))}
          </div>
        </div>

        {!isEnterprise && (
          <>
            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div style={{ marginBottom: 24 }}>
              <Text strong style={{ color: 'var(--color-text)', display: 'block', marginBottom: 12 }}>
                升级到付费版
              </Text>
              
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div 
                  style={{ 
                    flex: 1, 
                    padding: 16, 
                    border: `1px solid ${currentType === 'Personal' ? 'var(--color-warning)' : 'var(--color-border)'}`,
                    borderRadius: 8,
                    background: currentType === 'Personal' ? 'color-mix(in srgb, var(--color-warning) 5%, transparent)' : 'var(--color-bg-container)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <CrownOutlined style={{ color: 'var(--color-warning)' }} />
                    <Text strong style={{ color: 'var(--color-text)' }}>个人版</Text>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--color-text)', marginBottom: 8 }}>
                    ¥99<span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>/年</span>
                  </div>
                  <Button 
                    type="primary" 
                    block 
                    style={{ background: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
                    onClick={() => window.open('https://iterminal.app/buy?plan=personal')}
                  >
                    立即购买
                  </Button>
                </div>
                
                <div 
                  style={{ 
                    flex: 1, 
                    padding: 16, 
                    border: `1px solid ${currentType === 'Professional' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 8,
                    background: currentType === 'Professional' ? 'color-mix(in srgb, var(--color-primary) 5%, transparent)' : 'var(--color-bg-container)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <CrownOutlined style={{ color: 'var(--color-primary)' }} />
                    <Text strong style={{ color: 'var(--color-text)' }}>专业版</Text>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--color-text)', marginBottom: 8 }}>
                    ¥299<span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>/年</span>
                  </div>
                  <Button 
                    type="primary" 
                    block 
                    style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
                    onClick={() => window.open('https://iterminal.app/buy?plan=professional')}
                  >
                    立即购买
                  </Button>
                </div>
              </div>
            </div>

            <Divider style={{ margin: '16px 0', borderColor: 'var(--color-border)' }} />

            <div>
              <Text strong style={{ color: 'var(--color-text)', display: 'block', marginBottom: 12 }}>
                激活 License
              </Text>
              
              <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
                <Input 
                  placeholder="输入 License Key，如: IT-1-PERSONAL-XXXXXXXX-XXXX"
                  value={licenseKey}
                  onChange={e => setLicenseKey(e.target.value)}
                  onPressEnter={handleActivate}
                />
                <Button 
                  type="primary" 
                  onClick={handleActivate}
                  loading={licenseLoading}
                >
                  激活
                </Button>
              </Space.Compact>
              
              <Text type="secondary" style={{ fontSize: 12 }}>
                购买后 License Key 将发送到您的邮箱
              </Text>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderShortcutsSettings = () => {
    const shortcuts: { key: keyof ShortcutSettings; label: string; description: string }[] = [
      { key: 'clearScreen', label: '清屏', description: '清除终端内容' },
      { key: 'search', label: '搜索', description: '在终端中搜索文本' },
      { key: 'copy', label: '复制', description: '复制选中内容' },
      { key: 'paste', label: '粘贴', description: '粘贴剪贴板内容' },
      { key: 'newSession', label: '新建会话', description: '创建新的终端会话' },
      { key: 'closeSession', label: '关闭会话', description: '关闭当前会话' },
      { key: 'splitHorizontal', label: '水平分屏', description: '水平方向分割终端' },
      { key: 'splitVertical', label: '垂直分屏', description: '垂直方向分割终端' },
      { key: 'fullscreen', label: '全屏', description: '切换全屏模式' },
      { key: 'nextSession', label: '下一会话', description: '切换到下一个会话' },
      { key: 'prevSession', label: '上一会话', description: '切换到上一个会话' },
      { key: 'nextSuggestion', label: '下一条建议', description: '切换到下一条命令建议' },
      { key: 'prevSuggestion', label: '上一条建议', description: '切换到上一条命令建议' },
      { key: 'showHistory', label: '历史命令', description: '显示历史命令列表' },
      { key: 'shortcutHelp', label: '快捷键帮助', description: '显示快捷键列表' },
    ]

    return (
      <div style={{ padding: '0 16px' }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ color: 'var(--color-text)', display: 'block', marginBottom: 8 }}>
            终端快捷键
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            点击快捷键输入框，按下组合键后按 Enter 确认。按 Delete 清空，Esc 取消。
          </Text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shortcuts.map(({ key, label, description }) => (
            <div key={key} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--color-bg-container)',
              borderRadius: 6,
            }}>
              <div>
                <Text style={{ color: 'var(--color-text)', fontWeight: 500 }}>{label}</Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{description}</Text>
              </div>
              {editingShortcutKey === key ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 140 }}>
                  <div
                    style={{ 
                      width: '100%',
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--color-bg-elevated)',
                      border: '2px solid var(--color-primary)',
                      borderRadius: 6,
                      fontFamily: 'monospace',
                      color: tempShortcutKey ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                      fontSize: 13,
                      padding: '0 8px',
                    }}
                  >
                    {tempShortcutKey ? formatShortcutForDisplay(tempShortcutKey) : '按下组合键...'}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {tempShortcutKey ? 'Enter 确认 / Esc 取消' : 'Delete 清空 / Esc 取消'}
                  </Text>
                </div>
              ) : (
                <Tooltip title="点击修改，Delete 清空">
                  <Button
                    style={{ minWidth: 140, fontFamily: 'monospace' }}
                    onClick={() => {
                      setEditingShortcutKey(key)
                      setTempShortcutKey('')
                    }}
                  >
                    {shortcutSettings[key] ? formatShortcutForDisplay(shortcutSettings[key]) : <span style={{ color: 'var(--color-text-tertiary)' }}>未设置</span>}
                  </Button>
                </Tooltip>
              )}
            </div>
          ))}
        </div>

        <Divider style={{ margin: '24px 0', borderColor: 'var(--color-border)' }} />

        <Button 
          onClick={() => {
            resetShortcutSettings()
            message.success('已恢复默认快捷键')
          }}
        >
          恢复默认设置
        </Button>
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
      case 'license':
        return renderLicenseSettings()
      case 'shortcuts':
        return renderShortcutsSettings()
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

  const showFooter = activeCategory === 'terminal' || activeCategory === 'appearance'
  const isAppearancePage = activeCategory === 'appearance'

  return (
    <Modal
      title="系统设置"
      open={visible}
      onCancel={handleClose}
      footer={showFooter ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {isAppearancePage ? (
            <Button type="primary" onClick={handleClose}>
              完成
            </Button>
          ) : (
            <>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" onClick={handleSave} disabled={!hasTerminalChanges}>
                保存
              </Button>
            </>
          )}
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
            onClick={(e) => handleCategoryChange(e.key as SettingCategory)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text)',
            }}
            items={SETTING_CATEGORIES.map(item => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
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