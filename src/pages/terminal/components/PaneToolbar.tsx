import { Tooltip, Input } from 'antd'
import {
  ExportOutlined,
  ClearOutlined,
  SearchOutlined,
  BorderHorizontalOutlined,
  BorderVerticleOutlined,
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { useCallback, useState } from 'react'
import { SearchAddon } from '@xterm/addon-search'
import type { ShortcutSettings } from '../../../stores/terminalStore'

interface PaneToolbarProps {
  sessionKey: string
  shortcutSettings: ShortcutSettings
  hasSplitPanel: boolean
  searchAddons: React.MutableRefObject<{ [key: string]: SearchAddon }>
  searchVisible: boolean
  searchText: string
  searchMode: 'normal' | 'regex' | 'wholeWord'
  onToggleSearch: () => void
  onSearchTextChange: (text: string) => void
  onSearchModeChange: (mode: 'normal' | 'regex' | 'wholeWord') => void
  onSplitHorizontal: () => void
  onSplitVertical: () => void
  onCloseSplit?: () => void
  onClear: () => void
  onExport: () => void
}

export function PaneToolbar({
  sessionKey,
  shortcutSettings,
  hasSplitPanel,
  searchAddons,
  searchVisible,
  searchText,
  searchMode,
  onToggleSearch,
  onSearchTextChange,
  onSearchModeChange,
  onSplitHorizontal,
  onSplitVertical,
  onCloseSplit,
  onClear,
  onExport,
}: PaneToolbarProps) {
  const [isHovered, setIsHovered] = useState(false)

  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    const addon = searchAddons.current[sessionKey]
    if (!addon || !searchText) return
    
    const options = {
      caseSensitive: false,
      wholeWord: searchMode === 'wholeWord',
      regex: searchMode === 'regex',
    }
    
    if (direction === 'next') {
      addon.findNext(searchText, options)
    } else {
      addon.findPrevious(searchText, options)
    }
  }, [sessionKey, searchText, searchAddons, searchMode])

  const showToolbar = isHovered || searchVisible

  return (
    <div 
      style={{ 
        position: 'absolute', 
        top: 4, 
        right: 4, 
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'flex-end',
      }}
      onMouseLeave={() => !searchVisible && setIsHovered(false)}
    >
      {!showToolbar && (
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--color-bg-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            opacity: 0.6,
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={() => setIsHovered(true)}
        >
          <ToolOutlined style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} />
        </div>
      )}

      {showToolbar && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              background: 'var(--color-bg-elevated)',
              borderRadius: 4,
              padding: '2px 4px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <Tooltip title={`清屏 (${shortcutSettings.clearScreen})`}>
              <span
                style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={onClear}
              >
                <ClearOutlined />
              </span>
            </Tooltip>
            <Tooltip title="导出终端输出">
              <span
                style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={onExport}
              >
                <ExportOutlined />
              </span>
            </Tooltip>
            <Tooltip title="搜索">
              <span
                style={{ color: searchVisible ? 'var(--color-primary)' : 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={onToggleSearch}
              >
                <SearchOutlined />
              </span>
            </Tooltip>
            <div style={{ width: 1, height: 12, background: 'var(--color-border)', margin: '0 2px' }} />
            <Tooltip title={`水平分屏 (${shortcutSettings.splitHorizontal})`}>
              <span
                style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={onSplitHorizontal}
              >
                <BorderHorizontalOutlined />
              </span>
            </Tooltip>
            <Tooltip title={`垂直分屏 (${shortcutSettings.splitVertical})`}>
              <span
                style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                onClick={onSplitVertical}
              >
                <BorderVerticleOutlined />
              </span>
            </Tooltip>
            {hasSplitPanel && onCloseSplit && (
              <Tooltip title="关闭当前分屏">
                <span
                  style={{ color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px 4px', fontSize: 12 }}
                  onClick={onCloseSplit}
                >
                  <CloseOutlined />
                </span>
              </Tooltip>
            )}
          </div>

          {searchVisible && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                background: 'var(--color-bg-elevated)',
                borderRadius: 4,
                padding: '3px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Input
                size="small"
                placeholder="搜索..."
                value={searchText}
                onChange={(e) => onSearchTextChange(e.target.value)}
                onPressEnter={() => handleSearch('next')}
                style={{ 
                  width: 180, 
                  background: 'var(--color-bg-container)', 
                  border: '1px solid var(--color-border)', 
                  color: 'var(--color-text)', 
                  fontSize: 12,
                  height: 20,
                }}
                autoFocus
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'space-between', height: 18 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <Tooltip title="普通匹配">
                    <span
                      style={{ 
                        color: searchMode === 'normal' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', 
                        cursor: 'pointer', 
                        padding: '0 4px', 
                        fontSize: 10,
                        lineHeight: '18px',
                        background: searchMode === 'normal' ? 'var(--color-primary-bg)' : 'transparent',
                        borderRadius: 2,
                      }}
                      onClick={() => onSearchModeChange('normal')}
                    >
                      Aa
                    </span>
                  </Tooltip>
                  <Tooltip title="正则匹配">
                    <span
                      style={{ 
                        color: searchMode === 'regex' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', 
                        cursor: 'pointer', 
                        padding: '0 4px', 
                        fontSize: 10,
                        lineHeight: '18px',
                        fontFamily: 'monospace',
                        background: searchMode === 'regex' ? 'var(--color-primary-bg)' : 'transparent',
                        borderRadius: 2,
                      }}
                      onClick={() => onSearchModeChange('regex')}
                    >
                      .*
                    </span>
                  </Tooltip>
                  <Tooltip title="全词匹配">
                    <span
                      style={{ 
                        color: searchMode === 'wholeWord' ? 'var(--color-primary)' : 'var(--color-text-tertiary)', 
                        cursor: 'pointer', 
                        padding: '0 4px', 
                        fontSize: 10,
                        lineHeight: '18px',
                        fontFamily: 'monospace',
                        background: searchMode === 'wholeWord' ? 'var(--color-primary-bg)' : 'transparent',
                        borderRadius: 2,
                      }}
                      onClick={() => onSearchModeChange('wholeWord')}
                    >
                      "a"
                    </span>
                  </Tooltip>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  <span onClick={() => handleSearch('prev')} style={{ cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                    <LeftOutlined style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} />
                  </span>
                  <span onClick={() => handleSearch('next')} style={{ cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                    <RightOutlined style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} />
                  </span>
                  <span onClick={onToggleSearch} style={{ cursor: 'pointer', padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                    <CloseOutlined style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} />
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}