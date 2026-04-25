import React from 'react'
import type { TerminalThemeColors } from '../types/theme'

function computeGhostColor(foreground: string): string {
  const rgbaMatch = foreground.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch) {
    const r = rgbaMatch[1]
    const g = rgbaMatch[2]
    const b = rgbaMatch[3]
    const originalAlpha = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1
    return `rgba(${r}, ${g}, ${b}, ${(originalAlpha * 0.6).toFixed(2)})`
  }
  if (foreground.startsWith('#') && foreground.length === 7) {
    return foreground + '99'
  }
  return foreground
}

export const GhostTextOverlay = React.forwardRef<HTMLDivElement, {
  sessionKey: string
  fontFamily?: string
  fontSize?: number
  themeColors: TerminalThemeColors
}>(function GhostTextOverlay({
  sessionKey,
  fontFamily,
  fontSize,
  themeColors,
}, ref) {
  const ghostColor = React.useMemo(() => {
    return computeGhostColor(themeColors.foreground)
  }, [themeColors.foreground])

  return (
    <div
      ref={ref}
      data-session-key={sessionKey}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        color: ghostColor,
        fontFamily: fontFamily || 'Menlo, Monaco, monospace',
        fontSize: fontSize || 14,
        pointerEvents: 'none',
        zIndex: 1000,
        whiteSpace: 'pre',
        display: 'none',
        overflow: 'visible',
        maxWidth: 'none',
        width: 'auto',
        transform: 'translateY(-0.02em)',
      }}
    />
  )
})
