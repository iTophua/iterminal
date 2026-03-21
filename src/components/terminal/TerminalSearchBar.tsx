import { Input, Space, Button } from 'antd'
import { SearchMode } from '../../hooks/terminal'

interface TerminalSearchBarProps {
  visible: boolean
  text: string
  mode: SearchMode
  onTextChange: (text: string) => void
  onModeChange: (mode: SearchMode) => void
  onSearch: (direction: 'next' | 'prev') => void
  onClear: () => void
}

export function TerminalSearchBar({
  visible,
  text,
  mode,
  onTextChange,
  onModeChange,
  onSearch,
  onClear,
}: TerminalSearchBarProps) {
  if (!visible) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '4px 12px',
      background: 'var(--color-bg-container)',
      borderBottom: '1px solid var(--color-border)',
      gap: 8,
    }}>
      <Input
        size="small"
        placeholder="搜索..."
        value={text}
        onChange={e => onTextChange(e.target.value)}
        onPressEnter={() => onSearch('next')}
        style={{ width: 200 }}
      />
      <Space size={4}>
        <Button
          size="small"
          type={mode === 'normal' ? 'primary' : 'default'}
          onClick={() => onModeChange('normal')}
        >
          Aa
        </Button>
        <Button
          size="small"
          type={mode === 'regex' ? 'primary' : 'default'}
          onClick={() => onModeChange('regex')}
        >
          .*
        </Button>
        <Button
          size="small"
          type={mode === 'wholeWord' ? 'primary' : 'default'}
          onClick={() => onModeChange('wholeWord')}
        >
          "a"
        </Button>
      </Space>
      <Button size="small" onClick={() => onSearch('prev')}>上一个</Button>
      <Button size="small" onClick={() => onSearch('next')}>下一个</Button>
      <Button size="small" onClick={onClear}>清除</Button>
    </div>
  )
}