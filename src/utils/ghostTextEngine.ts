import type { IBufferCell, Terminal } from '@xterm/xterm'
import { matchPromptEnd } from './shellOutputParser'

/**
 * 命令提示（ghost text）引擎：以屏幕为准追踪命令行。
 *
 * 为什么不数按键：远端 shell 会自行改写命令行——Tab 补全、↑/↓ 翻历史、粘贴、
 * Ctrl+W / Home / End / 方向键等行内编辑，都不体现在按键序列里。靠按键累加出的
 * 「影子输入」一旦与屏幕脱节，提示就会消失、残留或接错内容。这里改为：
 *   - 按键到达时先按预测更新（不等网络回显，提示即时出现）；
 *   - 每次输出回显后，从终端缓冲区读出「输入起点 → 光标」之间的真实文本做校正。
 *     与预测不一致、又不是自己按键的滞后回显，就采纳屏幕（Tab/粘贴等外部改动）。
 *
 * 输入起点（提示符结尾）在该行第一次按键时记录——此时命令行为空，光标即起点。
 * 起点之后的布局变化（补全列表重绘、清屏、窗口缩放后的 shell 重绘）靠已追踪的文本
 * 反向定位恢复；恢复不了就不显示，不乱显示。
 *
 * 读屏与候选匹配都发生在 sync()（由持有者放在 requestAnimationFrame 里调用），
 * handleInput() 只做字符串运算，不在按键路径上产生 DOM 工作。
 */

/** 当前应显示的命令提示 */
export interface GhostView {
  /** 建议文本（接在光标之后） */
  text: string
  /** 全部候选，按匹配度排序 */
  candidates: string[]
  index: number
  /** 建议起点的视口行、列：光标停在行尾待换行时已是下一行的行首 */
  row: number
  col: number
  /**
   * 首行的列上限（不含），默认是终端列数。
   * 光标右侧隔着空白另有内容（zsh 的右侧提示符）时是那块内容的起始列，首行要停在它前面。
   */
  endCol: number
}

/** handleInput 对一个按键的处理结果：pass 透传给 shell；swallow 吞掉；accept 改为写入建议 */
export type GhostInputAction =
  | { type: 'pass' }
  | { type: 'swallow' }
  | { type: 'accept'; text: string }

export interface GhostTextEngineOptions {
  /** 按前缀取候选：返回去掉前缀后的后缀，按匹配度排序 */
  getSuggestions: (input: string) => string[]
}

type Anchor = { y: number; x: number }
type Pos = { row: number; col: number }
type RowText = { text: string; cellOf: number[] }

const PASS: GhostInputAction = { type: 'pass' }
const SWALLOW: GhostInputAction = { type: 'swallow' }

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_RIGHT = '\x1b[C'

// ─── 字符宽度（预测位置、提示折行用；真实位置始终以屏幕为准） ───

// 零宽：组合符号、变体选择符、零宽连接符等，依附前一个字符不占格（区间须按升序，二分查找）
const ZERO_WIDTH_RANGES: [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0730, 0x074a], [0x07a6, 0x07b0], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x0eb1, 0x0eb1], [0x0eb4, 0x0ebc], [0x135d, 0x135f],
  [0x1a17, 0x1a18], [0x1ab0, 0x1ace], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x2060, 0x2064],
  [0x20d0, 0x20f0], [0x2cef, 0x2cf1], [0x2de0, 0x2dff], [0x302a, 0x302f], [0x3099, 0x309a],
  [0xa66f, 0xa672], [0xa674, 0xa67d], [0xa69e, 0xa69f], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
]

// 东亚宽字符 / 全角（wcwidth 的 Wide + Fullwidth 主要区段）
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x187f7],
  [0x18800, 0x18cd5], [0x1b000, 0x1b2fb], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
  [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945], [0x1f947, 0x1f978], [0x1f97a, 0x1f9cb], [0x1f9cd, 0x1f9ff],
  [0x1fa70, 0x1fa74], [0x1fa78, 0x1fa7a], [0x1fa80, 0x1fa86], [0x1fa90, 0x1faa8],
  [0x1fab0, 0x1fab6], [0x1fac0, 0x1fac2], [0x1fad0, 0x1fad6], [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

function inRanges(cp: number, ranges: [number, number][]): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]
    if (cp < r[0]) hi = mid - 1
    else if (cp > r[1]) lo = mid + 1
    else return true
  }
  return false
}

/** 单个字符在终端里占的格数（0 / 1 / 2）。入参须是单个码点，可来自 for...of */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x300 || cp === 0x7f) return 1
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0
  if (inRanges(cp, WIDE_RANGES)) return 2
  return 1
}

export function stringWidth(str: string): number {
  let w = 0
  for (const ch of str) w += charWidth(ch)
  return w
}

/**
 * 把提示文本按终端列宽折成若干行。首行从 startCol 起排，之后每行从第 0 列起排；
 * 超出终端底部（maxRows 行放不下）的部分截掉。
 * firstLineEnd 是首行的列上限（不含），小于 cols 时首行提前折行。
 */
export function layoutGhostLines(
  text: string,
  startCol: number,
  cols: number,
  maxRows: number,
  firstLineEnd: number = cols,
): string[] {
  const lines: string[] = []
  if (cols <= 0 || maxRows <= 0) return lines
  let x = startCol
  let line = ''
  for (const ch of text) {
    const w = charWidth(ch)
    if (w > 0 && x + w > (lines.length === 0 ? firstLineEnd : cols)) {
      lines.push(line)
      if (lines.length >= maxRows) return lines
      x = 0
      line = ''
    }
    line += ch
    x += w
  }
  lines.push(line)
  return lines
}

/** 光标右侧的内容与光标之间至少隔这么多格，才算另起的一块（如 zsh 的右侧提示符）而不是行内的文字 */
const RIGHT_BLOCK_MIN_GAP = 2

/** 纯移动光标的按键：← → Home End Ctrl+A/E Ctrl+←/→ Alt+B/F */
const CURSOR_MOVE_KEY = /^(?:\x01|\x05|\x1b(?:\[|O)(?:[0-9;]*[DCHF]|[178]~)|\x1b[bf])$/

/** 是否普通可打印文本（可含多个字符，如输入法上屏/粘贴） */
function isPlainText(data: string): boolean {
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

/**
 * 补全列表等重绘后，按已追踪输入定位新行上的输入起点。
 * 补全只改写「当前词」，所以用「除最后一个词外」的前缀在行内自右向左找；
 * 没有前缀（正在补全第一个词）时，要求新词以原词开头（忽略大小写）。
 */
function locateByPrefix(seg: RowText, input: string): number | null {
  const cut = input.lastIndexOf(' ') + 1
  const head = input.slice(0, cut)
  const word = input.slice(cut)
  const lowerWord = word.toLowerCase()
  for (let i = seg.text.length - head.length; i >= 0; i--) {
    if (!seg.text.startsWith(head, i)) continue
    const rest = seg.text.slice(i + head.length)
    if (!rest) continue
    if (head === '' && !rest.toLowerCase().startsWith(lowerWord)) continue
    return seg.cellOf[i] ?? null
  }
  return null
}

export class GhostTextEngine {
  /** idle：命令行为空（刚回车/刚连上）；active：已记录输入起点；unknown：行上可能已有内容 */
  private phase: 'idle' | 'active' | 'unknown' = 'idle'
  private anchor: Anchor | null = null
  /** 光标之前的命令行文本（追踪值） */
  private input = ''
  /** 自上次与屏幕对齐后、每次按键前的预测值，用来识别自己按键的滞后回显 */
  private predicted: string[] = []
  /** 发出过会改写整行的按键，记下当时的输入；屏幕离开这个状态才算回显到位 */
  private dirtyFrom: string | null = null
  /** 布局已变（重绘/缩放），起点待重新定位 */
  private unanchored = false
  /** 光标在行尾 */
  private atEnd = true
  /** 命令正好占满一行：光标只能停在最后一列，建议要从下一行行首开始 */
  private atEndOverflow = false
  /** 最近一次按键是纯移动光标。用来区分「← 移到行尾字符上」和「shell 重绘满一行后把光标放在最后一列」 */
  private cursorMoved = false
  /** 建议首行的列上限（不含）：光标右侧另有内容时，提示要停在它前面 */
  private firstLineEnd = 0
  /** 调出历史命令/接受建议之后不再提示，直到再次编辑 */
  private suppress = false
  /** 本行至少被回显确认过一次。密码输入等不回显的场景因此不会出现提示 */
  private confirmed = false
  private index = 0
  private ghost: GhostView | null = null
  private queried = ''
  private candidates: string[] = []
  private readonly scratch: IBufferCell

  constructor(private readonly term: Terminal, private readonly opts: GhostTextEngineOptions) {
    this.scratch = term.buffer.active.getNullCell()
  }

  get view(): GhostView | null {
    if (!this.ghost) return null
    const buf = this.term.buffer.active
    // 视口不在底部时光标行不在屏幕上，提示无处可画
    if (buf.viewportY !== buf.baseY) return null
    return this.ghost
  }

  /**
   * 按键到达、尚未发给 shell 时调用。只更新追踪状态，提示在随后的 sync() 里重算。
   */
  handleInput(data: string): GhostInputAction {
    if (this.term.buffer.active.type === 'alternate') {
      this.reset()
      return PASS
    }
    // 回车 / Ctrl+C：命令行结束
    if (data === '\r' || data === '\n' || data === '\x03') {
      this.reset()
      return PASS
    }
    // 带换行的多字符输入（终端自身的粘贴路径）通常会直接执行，按回车处理
    if (data.includes('\r') || data.includes('\n')) {
      this.reset()
      return PASS
    }
    // Ctrl+R / Ctrl+S 增量搜索：命令行被搜索界面替换，起点未知
    if (data === '\x12' || data === '\x13') {
      this.reset()
      this.phase = 'unknown'
      return PASS
    }
    // Esc：有提示时只关闭提示，不发给 shell
    if (data === '\x1b') {
      if (this.ghost) {
        this.ghost = null
        return SWALLOW
      }
      return PASS
    }
    if (data === KEY_RIGHT) {
      if (this.ghost && this.atEnd) {
        const text = this.ghost.text
        this.predicted.push(this.input)
        this.input += text
        this.suppress = true
        this.cursorMoved = false
        this.ghost = null
        return { type: 'accept', text }
      }
      return this.mutate(data)
    }
    if (data === KEY_UP || data === KEY_DOWN) {
      // 翻历史调出的本身就是完整命令，再接延伸建议只是噪音
      const action = this.mutate(data)
      this.suppress = true
      return action
    }
    if (data === '\x7f' || data === '\b') {
      const last = this.input.charCodeAt(this.input.length - 1)
      // 退格删的是单个 ASCII 字符时可以直接预测；宽字符/组合字符等删掉的格数不定，等回显
      if (this.predictable() && this.input.length > 0 && last >= 0x20 && last < 0x7f) {
        this.predicted.push(this.input)
        this.input = this.input.slice(0, -1)
        this.cursorMoved = false
        this.edited()
        return PASS
      }
      return this.mutate(data)
    }
    if (isPlainText(data)) {
      // 起点丢了还在等 shell 重绘时又继续输入：不再干等，按当前行重新建立起点，
      // 重绘到达后 sync() 会把整行采纳回来
      if (this.phase !== 'active' || this.unanchored) {
        this.beginLine(this.phase === 'unknown' || this.unanchored)
      }
      if (!this.anchor) return PASS
      this.predicted.push(this.input)
      if (this.predicted.length > 64) this.predicted.shift()
      this.input += data
      this.cursorMoved = false
      this.edited()
      return PASS
    }
    // Tab、←、Home/End、Ctrl+W/A/E、Alt+组合键等：由 shell 改写命令行
    return this.mutate(data)
  }

  /** 输出写入终端之后调用（每帧最多一次）：读屏校正并重算提示 */
  sync(): void {
    const buf = this.term.buffer.active
    if (buf.type === 'alternate') {
      this.reset()
      return
    }
    if (this.phase !== 'active' || !this.anchor) {
      this.ghost = null
      return
    }
    if (!this.unanchored) {
      const endX = this.textEndX()
      const text = this.readInput(this.anchor, endX)
      if (text !== null) {
        if (text !== this.input) {
          if (this.predicted.includes(text)) {
            // 屏幕还停在之前某次按键的回显上，保持预测值
            this.refresh(this.predictPos())
            return
          }
          // Tab 补全、粘贴、行内编辑等外部改动：采纳屏幕
          this.input = text
          this.index = 0
        }
        this.predicted = []
        if (this.dirtyFrom !== null && text !== this.dirtyFrom) this.dirtyFrom = null
        this.confirmed = true
        this.atEnd = this.atEndOverflow || this.cursorAtLineEnd()
        this.refresh(this.cursorPos(endX))
        return
      }
    }
    this.reanchor()
  }

  /** 在候选间切换（1 下一条 / -1 上一条） */
  cycle(dir: 1 | -1): void {
    if (!this.ghost || this.ghost.candidates.length < 2) return
    const n = this.ghost.candidates.length
    this.index = (this.index + dir + n) % n
    this.ghost = { ...this.ghost, index: this.index, text: this.ghost.candidates[this.index] }
  }

  /** 命令行结束 / 会话状态不可信：清空全部追踪 */
  reset(): void {
    this.phase = 'idle'
    this.anchor = null
    this.input = ''
    this.predicted = []
    this.dirtyFrom = null
    this.unanchored = false
    this.atEnd = true
    this.suppress = false
    this.confirmed = false
    this.atEndOverflow = false
    this.cursorMoved = false
    this.firstLineEnd = 0
    this.index = 0
    this.ghost = null
    this.queried = ''
    this.candidates = []
  }

  /**
   * 有文本不经按键路径写入 shell（粘贴、历史弹窗选命令、AI/片段插入）。
   * 这类写入不经过 handleInput，等回显后由 sync() 重新对齐。
   * suppress：视同调出历史命令，回显后不给延伸建议。
   */
  noteExternalWrite(suppress = false): void {
    if (this.term.buffer.active.type === 'alternate') return
    if (this.phase !== 'active') this.beginLine(this.phase === 'unknown')
    this.dirtyFrom = this.input
    this.atEnd = false
    this.index = 0
    this.cursorMoved = false
    if (suppress) this.suppress = true
    this.ghost = null
  }

  /** 终端尺寸变化：shell 会重绘整行，起点待重绘后按已追踪文本重新定位 */
  noteResize(): void {
    if (this.phase !== 'active') return
    this.unanchored = true
    this.ghost = null
  }

  // ─── 内部 ───

  private predictable(): boolean {
    return this.phase === 'active' && this.dirtyFrom === null && !this.unanchored
  }

  private edited(): void {
    this.suppress = false
    this.index = 0
    // 输入变了，旧建议作废；新建议在随后 sync() 里算。
    // 否则同一帧内紧接着按 → 会把上一条输入的建议接上去。
    this.ghost = null
  }

  private mutate(data: string): GhostInputAction {
    if (this.phase !== 'active') this.beginLine(this.phase === 'unknown')
    this.dirtyFrom = this.input
    this.atEnd = false
    this.index = 0
    this.cursorMoved = CURSOR_MOVE_KEY.test(data)
    this.ghost = null
    return PASS
  }

  /**
   * 在当前光标处建立输入起点。此时命令行为空，光标即起点；
   * probe 为 true 表示行上可能已有内容（isearch 之后、起点丢失后的重试），按提示符格式找起点。
   */
  private beginLine(probe: boolean): void {
    const buf = this.term.buffer.active
    const y = buf.baseY + buf.cursorY
    let startX = buf.cursorX
    let text = ''
    if (probe) {
      const seg = this.readRow(y, 0, buf.cursorX)
      const end = seg ? matchPromptEnd(seg.text) : null
      if (seg && end !== null) {
        startX = seg.cellOf[end] ?? buf.cursorX
        text = this.readCells(y, startX, buf.cursorX)
      }
    }
    this.anchor = { y, x: startX }
    this.input = text
    this.predicted = []
    this.dirtyFrom = null
    this.unanchored = false
    this.atEnd = true
    this.confirmed = false
    this.index = 0
    this.phase = 'active'
  }

  /**
   * 起点 → 光标 的真实文本；光标不在起点所在的（软换行）行上时返回 null。
   * endX 是光标行上的右边界列（见 textEndX），可以等于终端列数。
   */
  private readInput(a: Anchor, endX: number): string | null {
    const buf = this.term.buffer.active
    const cols = this.term.cols
    const curY = buf.baseY + buf.cursorY
    const curX = endX
    if (curY < a.y || (curY === a.y && curX < a.x)) return null
    if (curY === a.y) return this.readCells(a.y, a.x, curX)
    let text = this.trimWrappedTail(this.readCells(a.y, a.x, cols), a.y)
    for (let y = a.y + 1; y < curY; y++) {
      const line = buf.getLine(y)
      if (!line || !line.isWrapped) return null
      text += this.trimWrappedTail(this.readCells(y, 0, cols), y)
    }
    const last = buf.getLine(curY)
    if (!last || !last.isWrapped) return null
    return text + this.readCells(curY, 0, curX)
  }

  /** 第 y 行 [x0, x1) 列的文本，字符与格一一对应之外（宽字符占位）自动跳过 */
  private readCells(y: number, x0: number, x1: number): string {
    const line = this.term.buffer.active.getLine(y)
    const end = Math.min(x1, this.term.cols)
    if (!line || x0 >= end) return ''
    // 快路径：纯 ASCII 段列号即下标，直接取缓存字符串
    const fast = line.translateToString(false, x0, end)
    if (/^[\x20-\x7e]*$/.test(fast)) return fast
    let out = ''
    for (let x = x0; x < end; x++) {
      const cell = line.getCell(x, this.scratch)
      if (!cell) break
      const w = cell.getWidth()
      if (w === 0) continue
      out += cell.getChars() || ' '
      if (w === 2) x++
    }
    return out
  }

  /** 同 readCells，但同时给出每个字符的起始列号（提示符/前缀定位要换算回列） */
  private readRow(y: number, x0: number, x1: number): RowText | null {
    const line = this.term.buffer.active.getLine(y)
    if (!line) return null
    const end = Math.min(x1, this.term.cols)
    let text = ''
    const cellOf: number[] = []
    for (let x = x0; x < end; x++) {
      const cell = line.getCell(x, this.scratch)
      if (!cell) break
      const w = cell.getWidth()
      if (w === 0) continue
      cellOf.push(x)
      text += cell.getChars() || ' '
      if (w === 2) x++
    }
    cellOf.push(end)
    return { text, cellOf }
  }

  /** 整行被输入占满时，行尾若是为放不下宽字符留的空格，下一行续排的文本里不该有它 */
  private trimWrappedTail(text: string, y: number): string {
    if (!text.endsWith(' ')) return text
    const buf = this.term.buffer.active
    const line = buf.getLine(y)
    const next = buf.getLine(y + 1)
    if (!line || !next || !next.isWrapped) return text
    const last = line.getCell(this.term.cols - 1, this.scratch)
    if (!last || last.getWidth() !== 1 || (last.getChars() || ' ') !== ' ') return text
    const first = next.getCell(0, this.scratch)
    if (!first || first.getWidth() !== 2) return text
    return text.slice(0, -1)
  }

  /**
   * 光标右侧到行尾（含后续软换行续行）是否全为空。
   *
   * 光标所在行右侧若隔着一段空白另有内容——zsh 的右侧提示符（RPROMPT）、powerlevel10k 的右侧信息——
   * 仍算在行尾，但那不是提示可以占的位置：记下它的起始列作为首行的列上限。
   * 紧挨着光标（或只隔一格）的内容说明光标在文字中间，不算行尾。
   */
  private cursorAtLineEnd(): boolean {
    const buf = this.term.buffer.active
    const cols = this.term.cols
    const cursorRow = buf.baseY + buf.cursorY
    let y = cursorRow
    let from = Math.min(buf.cursorX, cols)
    for (let guard = 0; guard < 256; guard++) {
      const line = buf.getLine(y)
      if (!line) return true
      const rest = this.readCells(y, from, cols)
      if (!/^ *$/.test(rest)) {
        let gap = 0
        while (gap < rest.length && rest.charCodeAt(gap) === 0x20) gap++
        if (y !== cursorRow || gap < RIGHT_BLOCK_MIN_GAP) return false
        this.firstLineEnd = from + gap
      }
      const next = buf.getLine(y + 1)
      if (!next || !next.isWrapped) return true
      y++
      from = 0
    }
    return true
  }

  /**
   * 「光标前文本」在光标行上的右边界列。
   *
   * 光标停在最后一列的字符上时有两可能：← 移到了行尾字符上（那一格在光标之后），
   * 或 shell 重绘了正好占满一行的命令——光标没法越过最后一列，只能停在行末（那一格在光标之前）。
   * xterm 里敲进最后一列的字符会让光标停在「列数」这个虚拟位置上，所以只有重绘才会出现后一种情况。
   * 用「最近一次按键是不是纯移动光标」区分；后一种情况记为 atEndOverflow，建议从下一行行首开始。
   */
  private textEndX(): number {
    const buf = this.term.buffer.active
    const cols = this.term.cols
    this.atEndOverflow = false
    this.firstLineEnd = cols
    if (!this.cursorMoved && buf.cursorX === cols - 1) {
      const cell = buf.getLine(buf.baseY + buf.cursorY)?.getCell(cols - 1, this.scratch)
      if (cell && cell.getWidth() > 0 && (cell.getChars() || '') !== '') this.atEndOverflow = true
    }
    return Math.min(buf.cursorX + (this.atEndOverflow ? 1 : 0), cols)
  }

  /** 光标处（光标行上的右边界列可以等于终端列数，即停在行尾待换行）→ 建议起点的视口行、列 */
  private cursorPos(endX: number): Pos {
    const buf = this.term.buffer.active
    return endX >= this.term.cols ? { row: buf.cursorY + 1, col: 0 } : { row: buf.cursorY, col: endX }
  }

  /** 回显未到时，提示应出现的位置：起点列 + 已追踪输入的宽度 */
  private predictPos(): Pos {
    const buf = this.term.buffer.active
    const cols = this.term.cols
    const a = this.anchor as Anchor
    const cells = a.x + stringWidth(this.input)
    const cursorRowsBelowAnchor = buf.baseY + buf.cursorY - a.y
    return {
      row: buf.cursorY + Math.floor(cells / cols) - cursorRowsBelowAnchor,
      col: cells % cols,
    }
  }

  /** 重算提示。show 条件不满足时清掉 */
  private refresh(pos: Pos): void {
    const show =
      this.confirmed && this.dirtyFrom === null && !this.unanchored && !this.suppress &&
      this.atEnd && this.input.length > 0
    if (!show) {
      this.ghost = null
      return
    }
    if (this.input !== this.queried) {
      this.candidates = this.opts.getSuggestions(this.input) ?? []
      this.queried = this.input
    }
    if (!this.candidates.length) {
      this.ghost = null
      return
    }
    if (this.index >= this.candidates.length) this.index = 0
    this.ghost = {
      text: this.candidates[this.index],
      candidates: this.candidates,
      index: this.index,
      endCol: this.firstLineEnd,
      ...pos,
    }
  }

  /** 布局已变：在光标处重新定位输入起点 */
  private reanchor(): void {
    const buf = this.term.buffer.active
    const curY = buf.baseY + buf.cursorY
    const curX = this.textEndX()
    const dirty = this.dirtyFrom !== null
    // (1) 已追踪的文本原样在屏幕上、止于光标
    let found: Anchor | null = this.locateExact(curY, curX)

    const seg = this.readRow(curY, 0, curX)
    // (2) 常见提示符格式
    if (!found && seg) {
      const end = matchPromptEnd(seg.text)
      if (end !== null) {
        const a = { y: curY, x: seg.cellOf[end] ?? curX }
        if (dirty || this.readCells(curY, a.x, curX) === this.input) found = a
      }
    }
    // (3) 补全改写了最后一个词、又换了行重绘（列出候选后）
    if (!found && seg && dirty) {
      const x = locateByPrefix(seg, this.input)
      if (x !== null) found = { y: curY, x }
    }

    if (!found) {
      // 等 shell 重绘后再试；在此之前不显示
      this.unanchored = true
      this.ghost = null
      return
    }
    this.anchor = found
    this.unanchored = false
    const text = this.readInput(found, curX)
    if (text === null) {
      this.unanchored = true
      this.ghost = null
      return
    }
    this.input = text
    this.predicted = []
    this.dirtyFrom = null
    this.confirmed = true
    this.atEnd = this.atEndOverflow || this.cursorAtLineEnd()
    this.refresh(this.cursorPos(curX))
  }

  /** 用已追踪输入的宽度，从光标反推它在屏幕上的起点 */
  private locateExact(curY: number, curX: number): Anchor | null {
    const need = stringWidth(this.input)
    const buf = this.term.buffer.active
    const cols = this.term.cols
    // 输入整体在光标所在行
    if (curX >= need) {
      const x = curX - need
      if (this.readCells(curY, x, curX) === this.input) return { y: curY, x }
      // 组合字符等占位可能带来一格误差，向左再试一格
      if (x >= 1 && this.readCells(curY, x - 1, curX) === this.input) return { y: curY, x: x - 1 }
    }
    // 输入跨行（软换行）：沿续行标记找到行链首，按格数反推
    let top = curY
    while (top > 0 && buf.getLine(top)?.isWrapped) top--
    if (curY === top) return null
    const start = (curY - top) * cols + curX - need
    if (start < 0) return null
    const a = { y: top + Math.floor(start / cols), x: start % cols }
    return this.readInput(a, curX) === this.input ? a : null
  }
}
