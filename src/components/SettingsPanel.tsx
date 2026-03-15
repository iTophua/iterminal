import { Modal, Select, Slider, Typography, Button, Menu, Spin, Radio, Divider } from 'antd'
import { useTerminalStore, type TerminalSettings } from '../stores/terminalStore'
import { useThemeStore } from '../stores/themeStore'
import { useState, useEffect } from 'react'
import { CodeOutlined, BgColorsOutlined, KeyOutlined, InfoCircleOutlined, SunOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons'
import { terminalThemesList } from '../styles/themes/terminal-themes'

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

type SettingCategory = 'appearance' | 'terminal' | 'shortcuts' | 'about'

const SETTING_CATEGORIES = [
  { key: 'appearance', label: '外观', icon: <BgColorsOutlined /> },
  { key: 'terminal', label: '终端', icon: <CodeOutlined /> },
  { key: 'shortcuts', label: '快捷键', icon: <KeyOutlined />, disabled: true },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined />, disabled: true },
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

  useEffect(() => {
    if (visible) {
      setTempSettings(terminalSettings)
      setHasTerminalChanges(false)
      setActiveCategory('appearance')
    }
  }, [visible, terminalSettings])

  const handleFontChange = (value: TerminalSettings['fontFamily']) => {
    setTempSettings(prev => ({ ...prev, fontFamily: value }))
    setHasTerminalChanges(true)
  }

  const handleFontSizeChange = (value: number) => {
    setTempSettings(prev => ({ ...prev, fontSize: value }))
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

  const renderContent = () => {
    switch (activeCategory) {
      case 'appearance':
        return renderAppearanceSettings()
      case 'terminal':
        return renderTerminalSettings()
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
        <div style={{ flex: 1, padding: '16px 0', background: 'var(--color-bg-elevated)' }}>
          {renderContent()}
        </div>
      </div>
    </Modal>
  )
}