import { Modal, Select, Slider, Typography, Menu, Spin, Radio } from 'antd'
import { useTerminalStore, type TerminalSettings } from '../stores/terminalStore'
import { useThemeStore, type AppThemeMode, type TerminalThemeKey } from '../stores/themeStore'
import { useState, useEffect } from 'react'
import { CodeOutlined, BgColorsOutlined, KeyOutlined, InfoCircleOutlined } from '@ant-design/icons'

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

type SettingCategory = 'terminal' | 'appearance' | 'shortcuts' | 'about'

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
  const setThemeMode = useThemeStore(state => state.setThemeMode)
  const terminalTheme = useThemeStore(state => state.terminalTheme)
  const setTerminalTheme = useThemeStore(state => state.setTerminalTheme)
  
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('appearance')
  const [tempSettings, setTempSettings] = useState<TerminalSettings>(terminalSettings)

  useEffect(() => {
    if (visible) {
      setTempSettings(terminalSettings)
      setActiveCategory('appearance')
    }
  }, [visible, terminalSettings])

  const handleFontChange = (value: TerminalSettings['fontFamily']) => {
    setTempSettings(prev => ({ ...prev, fontFamily: value }))
  }

  const handleFontSizeChange = (value: number) => {
    setTempSettings(prev => ({ ...prev, fontSize: value }))
  }

  useEffect(() => {
    if (tempSettings.fontFamily !== terminalSettings.fontFamily || 
        tempSettings.fontSize !== terminalSettings.fontSize) {
      updateTerminalSettings(tempSettings)
    }
  }, [tempSettings, terminalSettings, updateTerminalSettings])

  const renderAppearanceSettings = () => (
    <div style={{ padding: '0 16px' }}>
      <Text strong style={{ color: '#CCC', display: 'block', marginBottom: 16 }}>
        外观设置
      </Text>

      <div style={{ marginBottom: 24 }}>
        <Text style={{ color: '#999', display: 'block', marginBottom: 8 }}>
          应用主题
        </Text>
        <Radio.Group
          value={appThemeMode}
          onChange={(e) => setThemeMode(e.target.value as AppThemeMode)}
          buttonStyle="solid"
          style={{ display: 'flex', gap: 8 }}
        >
          <Radio.Button value="light">浅色</Radio.Button>
          <Radio.Button value="dark">深色</Radio.Button>
          <Radio.Button value="system">跟随系统</Radio.Button>
        </Radio.Group>
      </div>

      <div>
        <Text style={{ color: '#999', display: 'block', marginBottom: 8 }}>
          终端主题
        </Text>
        <Select
          value={terminalTheme}
          onChange={(value) => setTerminalTheme(value as TerminalThemeKey)}
          style={{ width: '100%' }}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'solarized-dark', label: 'Solarized Dark' },
            { value: 'solarized-light', label: 'Solarized Light' },
            { value: 'dracula', label: 'Dracula' },
            { value: 'one-dark', label: 'One Dark' },
          ]}
        />
      </div>
    </div>
  )

  const renderTerminalSettings = () => (
    <div style={{ padding: '0 16px' }}>
      <Text strong style={{ color: '#CCC', display: 'block', marginBottom: 16 }}>
        终端设置
      </Text>

      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: '#999', display: 'block', marginBottom: 8 }}>
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
        <Text style={{ color: '#999', display: 'block', marginBottom: 8 }}>
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
        <Text style={{ color: '#999', display: 'block', marginBottom: 8 }}>
          预览
        </Text>
        <div
          style={{
            background: '#1E1E1E',
            border: '1px solid #3F3F46',
            borderRadius: 6,
            padding: 12,
            fontFamily: `"${tempSettings.fontFamily}", Menlo, Monaco, monospace`,
            fontSize: tempSettings.fontSize,
            color: '#CCC',
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

  const renderContent = () => {
    switch (activeCategory) {
      case 'appearance':
        return renderAppearanceSettings()
      case 'terminal':
        return renderTerminalSettings()
      default:
        return (
          <div style={{ padding: '0 16px', textAlign: 'center', color: '#666', marginTop: 40 }}>
            该功能正在开发中...
          </div>
        )
    }
  }

  return (
    <Modal
      title="系统设置"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
      styles={{
        body: { padding: 0 },
        header: { borderBottom: '1px solid #3F3F46' },
      }}
    >
      <div style={{ display: 'flex', minHeight: 400 }}>
        <div style={{
          width: 140,
          borderRight: '1px solid #3F3F46',
          padding: '12px 0',
          background: '#1E1E1E',
        }}>
          <Menu
            mode="vertical"
            selectedKeys={[activeCategory]}
            onClick={(e) => setActiveCategory(e.key as SettingCategory)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#CCC',
            }}
            items={SETTING_CATEGORIES.map(item => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              disabled: item.disabled,
            }))}
          />
        </div>
        <div style={{ flex: 1, padding: '16px 0', background: '#252526' }}>
          {renderContent()}
        </div>
      </div>
    </Modal>
  )
}