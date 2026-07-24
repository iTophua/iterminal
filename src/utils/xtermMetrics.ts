/**
 * xterm.js 终端度量与缓冲区工具
 *
 * 用途：为命令提示（ghost text）浮层提供精确的单元格尺寸和缓冲区类型判定。
 *
 * 为什么需要单独抽出来：
 * 1. 原实现用 `screenRect.width / cols` 近似单元格宽度，但 `.xterm-screen` 元素宽度
 *    可能包含滚动条 / 末端留白，导致计算出的 cellWidth 比真实渲染宽度偏大，
 *    ghost text 浮层位置向右越偏越多。改用 xterm 内部 `_renderService.dimensions`
 *    （FitAddon 也依赖此 API）拿到 CSS 像素级精确的 cell 宽高。
 * 2. 暴露缓冲区类型判定（normal / alternate），用于在 vi/nano/less/tmux 等进入
 *    备用屏时禁用命令提示追踪，避免在编辑器/分页器里误触发。
 *
 * 注意：依赖 xterm 内部 _core / _renderService（非公开 API），xterm 升级时需重新适配。
 * 所有访问都带结构守卫，失败时回退到近似计算或安全默认值，不抛错。
 */
import type { Terminal as XTerm } from '@xterm/xterm'

/**
 * 从 xterm 内部 _renderService.dimensions 读取 CSS 像素级单元格尺寸。
 * 失败时回退到用容器实测的近似值，保证功能不中断。
 *
 * @param term  xterm 实例
 * @param xtermScreen  `.xterm-screen` 元素，仅在回退时用于近似测量
 * @returns { cellWidth, cellHeight }（CSS 像素），失败返回 null
 */
export function getXtermCellMetrics(
  term: XTerm,
  xtermScreen?: HTMLElement | null,
): { cellWidth: number; cellHeight: number } | null {
  try {
    // 与 FitAddon 一致的内部 API 访问路径
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: any } } })._core
    const dims = core?._renderService?.dimensions
    const cssCell = dims?.css?.cell
    if (cssCell && typeof cssCell.width === 'number' && typeof cssCell.height === 'number'
      && cssCell.width > 0 && cssCell.height > 0) {
      return { cellWidth: cssCell.width, cellHeight: cssCell.height }
    }
  } catch {
    // 静默降级
  }

  // 降级：用容器实测近似值（旧行为，不够精确但保证不崩）
  if (xtermScreen) {
    try {
      const rows = term.rows || 24
      const cols = term.cols || 80
      const rect = xtermScreen.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return {
          cellWidth: rect.width / cols,
          cellHeight: rect.height / rows,
        }
      }
    } catch {
      // 静默降级
    }
  }

  return null
}

/**
 * 判断终端是否处于备用屏（alternate buffer）。
 * vi/nano/less/man/tmux/top 等全屏程序会进入备用屏；在这些程序里不应做命令提示。
 *
 * @returns true 表示当前在备用屏
 */
export function isAlternateBuffer(term: XTerm): boolean {
  try {
    return term.buffer.active.type === 'alternate'
  } catch {
    return false
  }
}
