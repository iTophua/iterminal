const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0

export function TitleBar() {
  if (!IS_MAC) return null

  return (
    <div
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        background: 'var(--color-bg-elevated)',
        borderBottom: '1px solid var(--color-border)',
        userSelect: 'none',
        flexShrink: 0,
        zIndex: 100,
      }}
    >
      {/* 左侧空白占位（给 macOS 红绿灯按钮留空间），同时可拖拽 */}
      <div
        data-tauri-drag-region
        style={{
          width: 80,
          height: '100%',
          flexShrink: 0,
          WebkitAppRegion: 'drag',
        } as any}
      />

      {/* 中间标题文字，可拖拽 */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          WebkitAppRegion: 'drag',
        } as any}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text)',
            pointerEvents: 'none',
          }}
        >
          iTerminal
        </span>
      </div>

      {/* 右侧空白占位，可拖拽 */}
      <div
        data-tauri-drag-region
        style={{
          width: 80,
          height: '100%',
          flexShrink: 0,
          WebkitAppRegion: 'drag',
        } as any}
      />
    </div>
  )
}
