import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { GhostTextOverlay, paintGhostText, hideGhostText } from '../GhostTextOverlay'
import type { TerminalThemeColors } from '../../types/theme'

function setup() {
  let el: HTMLDivElement | null = null
  render(
    <GhostTextOverlay
      ref={node => { el = node }}
      sessionKey="conn-1_s1"
      fontFamily="Menlo"
      fontSize={14}
      themeColors={{ foreground: '#cccccc' } as TerminalThemeColors}
    />
  )
  return el!
}

describe('GhostTextOverlay', () => {
  it('初始隐藏；建议文字用前景色的半透明', () => {
    const el = setup()
    expect(el.style.display).toBe('none')
    expect(el.style.color).toBe('rgba(204, 204, 204, 0.6)')
    expect(el.style.whiteSpace).toBe('pre')
  })

  it('单行建议：定位在光标处', () => {
    const el = setup()
    paintGhostText(el, { lines: ['ker ps -a'], startCol: 5, top: 20, left: 40, cellWidth: 8, cellHeight: 16 })
    expect(el.style.display).toBe('block')
    expect(el.style.top).toBe('20px')
    expect(el.style.left).toBe('40px')
    expect(el.style.lineHeight).toBe('16px')
    expect(el.children).toHaveLength(1)
    expect(el.textContent).toBe('ker ps -a')
    expect((el.children[0] as HTMLElement).style.position).toBe('')
  })

  it('命令接近行尾：建议折到下一行、回到终端第 0 列', () => {
    const el = setup()
    paintGhostText(el, {
      lines: [' -a --all', ' --filter name=nginx', 'tail'],
      startCol: 11,
      top: 32,
      left: 2 + 11 * 8,
      cellWidth: 8,
      cellHeight: 16,
    })
    const lines = Array.from(el.children) as HTMLElement[]
    expect(lines.map(l => l.textContent)).toEqual([' -a --all', ' --filter name=nginx', 'tail'])
    // 浮层左缘在第 11 列，后续各行要左移 11 格才回到终端第 0 列
    expect(lines[0].style.position).toBe('')
    expect(lines[1].style.position).toBe('absolute')
    expect(lines[1].style.left).toBe('-88px')
    expect(lines[1].style.top).toBe('16px')
    expect(lines[2].style.left).toBe('-88px')
    expect(lines[2].style.top).toBe('32px')
  })

  it('内容没变时只挪位置，不重建子节点', () => {
    const el = setup()
    const paint = { lines: ['ker ps -a'], startCol: 5, top: 20, left: 40, cellWidth: 8, cellHeight: 16 }
    paintGhostText(el, paint)
    const first = el.children[0]
    paintGhostText(el, { ...paint, top: 36 })
    expect(el.children[0]).toBe(first)
    expect(el.style.top).toBe('36px')

    paintGhostText(el, { ...paint, lines: ['cker ps -a'], startCol: 4, left: 32 })
    expect(el.children[0]).not.toBe(first)
    expect(el.textContent).toBe('cker ps -a')
  })

  it('隐藏后再显示', () => {
    const el = setup()
    paintGhostText(el, { lines: ['ker'], startCol: 3, top: 0, left: 24, cellWidth: 8, cellHeight: 16 })
    hideGhostText(el)
    expect(el.style.display).toBe('none')
    paintGhostText(el, { lines: ['ker'], startCol: 3, top: 0, left: 24, cellWidth: 8, cellHeight: 16 })
    expect(el.style.display).toBe('block')
    expect(el.textContent).toBe('ker')
  })
})
