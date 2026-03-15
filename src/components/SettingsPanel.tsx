import { Modal, Select, Slider, Typography, Button, Menu, Spin } from 'antd'
import { useTerminalStore, type TerminalSettings } from '../stores/terminalStore'
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
  { key: 'terminal', label: '终端', icon: <CodeOutlined /> },
  { key: 'appearance', label: '外观', icon: <BgColorsOutlined />, disabled: true },
  { key: 'shortcuts', label: '快捷键', icon: <KeyOutlined />, disabled: true },
  { key: 'about', label: '关于', icon: <InfoCircleOutlined />, disabled: true },
]

export default function SettingsPanel({ visible, onClose }: SettingsPanelProps) {
  const terminalSettings = useTerminalStore(state => state.terminalSettings)
  const updateTerminalSettings = useTerminalStore(state => state.updateTerminalSettings)
  const availableFonts = useTerminalStore(state => state.availableFonts)
  const fontsLoading = useTerminalStore(state => state.fontsLoading)
  
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('terminal')
  const [tempSettings, setTempSettings] = useState<TerminalSettings>(terminalSettings)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (visible) {
      setTempSettings(terminalSettings)
      setHasChanges(false)
      setActiveCategory('terminal')
    }
  }, [visible, terminalSettings])

  const handleFontChange = (value: TerminalSettings['fontFamily']) => {
    setTempSettings(prev => ({ ...prev, fontFamily: value }))
    setHasChanges(true)
  }

  const handleFontSizeChange = (value: number) => {
    setTempSettings(prev => ({ ...prev, fontSize: value }))
    setHasChanges(true)
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
      onCancel={handleClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" onClick={handleSave} disabled={!hasChanges} style={{ background: '#00b96b' }}>
            保存
          </Button>
        </div>
      }
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