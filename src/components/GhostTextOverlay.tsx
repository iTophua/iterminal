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

/** 一次命令提示的绘制参数 */
export interface GhostPaint {
  /** 建议各行文本，已按终端列宽折好 */
  lines: string[]
  /** 首行的起始列 */
  startCol: number
  /** 首行左上角相对定位容器的位置（CSS 像素） */
  top: number
  left: number
  cellWidth: number
  cellHeight: number
}

/**
 * 把命令提示画到浮层元素上。
 *
 * 首行从光标处（startCol 列）起排，折行后的后续各行要回到终端第 0 列：
 * 它们绝对定位在首行下方、相对浮层向左移 startCol 格。
 * 文本和偏移都没变时不重建子节点——每次回显都会走到这里。
 */
export function paintGhostText(el: HTMLDivElement, paint: GhostPaint): void {
  const { lines, startCol, top, left, cellWidth, cellHeight } = paint
  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.lineHeight = `${cellHeight}px`

  const signature = `${cellWidth}|${cellHeight}|${startCol}|${lines.join('\u0001')}`
  if (el.dataset.ghost !== signature) {
    el.dataset.ghost = signature
    el.replaceChildren(...lines.map((text, i) => {
      const line = document.createElement('div')
      line.textContent = text
      if (i > 0 && startCol > 0) {
        line.style.position = 'absolute'
        line.style.top = `${i * cellHeight}px`
        line.style.left = `${-startCol * cellWidth}px`
      }
      return line
    }))
  }
  el.style.display = 'block'
}

/** 隐藏命令提示浮层（已隐藏时不碰 DOM） */
export function hideGhostText(el: HTMLDivElement | null | undefined): void {
  if (el && el.style.display !== 'none') el.style.display = 'none'
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
