/**
 * 会话日志：把终端输出去掉转义序列后按会话写成纯文本，供事后审计、复盘。
 * 这里只管文本处理和攒批，写盘由调用方注入（见 services/sessionLog.ts）。
 */

export interface SessionMeta {
  name: string
  host: string
  port: number
  user: string
}

export interface SessionLoggerOptions {
  /** 往文件追加一段文本；文件或目录不存在时由它负责创建 */
  write: (path: string, content: string) => Promise<void>
  /** 攒够这么多字符就写一次 */
  flushChars?: number
  /** 最长隔这么久写一次 */
  flushMs?: number
  now?: () => Date
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 写盘失败时调用一次，之后停止记录 */
  onError?: (error: unknown) => void
}

// 转义序列：CSI（颜色、光标移动）、OSC / DCS / APC 等字符串序列、字符集切换（ESC ( B）、其余两字符转义
const CSI = /^\x1b\[[0-?]*[ -/]*[@-~]/
const STRING_SEQUENCE = /^\x1b(?:[PX^_]|\])[^\x07]*?(?:\x07|\x1b\\)/
const CHARSET_SEQUENCE = /^\x1b[()*+][@-~]/
// 结尾还没收完整的序列以此开头：CSI 缺终止字节、字符串序列缺结束符
const INCOMPLETE_CSI = /^\x1b\[[0-?]*[ -/]*$/
const STRING_START = /^\x1b[PX^_\]]/
const CHARSET_START = /^\x1b[()*+]/

/** 一次最多留这么多字符等下一个数据块，防止坏掉的输出流把内存吃光 */
const MAX_CARRY = 4096

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * 去掉开头的转义序列，返回剩下的纯文本和结尾没收完整的部分。
 * 分块到达的输出里，一个转义序列可能被切成两半，所以要把尾巴留到下一块再处理。
 */
export function drainEscapes(text: string): { plain: string; rest: string } {
  let plain = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '\x1b') {
      const rest = text.slice(index)
      const complete =
        CSI.exec(rest) ?? STRING_SEQUENCE.exec(rest) ?? CHARSET_SEQUENCE.exec(rest)
      if (complete) {
        index += complete[0].length
        continue
      }
      // 没有完整序列：开头都没收全的 CSI / 字符串序列 / 字符集切换，以及单独的 ESC，留到下一块；
      // ESC 后面跟着的不是序列字符的，按两字符转义吃掉
      if (rest === '\x1b' || INCOMPLETE_CSI.test(rest) || STRING_START.test(rest) || CHARSET_START.test(rest)) {
        return { plain, rest }
      }
      index += 2
      continue
    }
    plain += text[index]
    index++
  }
  return { plain, rest: '' }
}

/** 控制字符：换行统一成 \n，其余（回车、退格、响铃之类）去掉 */
function cleanControl(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

/** 整段终端输出 → 日志用的纯文本。只适合一次拿到完整内容时用；分块请走 SessionLogger */
export function toPlainLogText(text: string): string {
  return cleanControl(drainEscapes(text).plain)
}

/** 文件名里不能出现的字符换成下划线 */
function safeName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\x00-\x1f\s]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'session'
}

function timestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function sessionLogFileName(dir: string, meta: SessionMeta, date: Date, suffix: string): string {
  const root = dir.trim().replace(/\/+$/, '')
  return `${root}/${safeName(meta.name)}_${safeName(meta.host)}_${timestamp(date)}_${suffix}.log`
}

/** 一条规则：同一秒内同一台机器的两个会话也能分开 */
function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 6)
}

/**
 * 一个会话一个写入器。输出先进缓冲，攒够量或到时间再写，避免每来一块输出就写一次盘。
 * 写入按顺序串行；第一次写失败就停掉并只报告一次，绝不让日志拖累终端。
 */
export class SessionLogger {
  readonly path: string
  private buffer = ''
  private carry = ''
  private timer: unknown
  private pending: Promise<void> = Promise.resolve()
  private closed = false
  private failed = false
  private readonly flushChars: number
  private readonly flushMs: number
  private readonly now: () => Date
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(dir: string, private readonly meta: SessionMeta, private readonly options: SessionLoggerOptions) {
    this.flushChars = options.flushChars ?? 16 * 1024
    this.flushMs = options.flushMs ?? 1000
    this.now = options.now ?? (() => new Date())
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))

    this.path = sessionLogFileName(dir, meta, this.now(), randomSuffix())
    // 文件一开始就建出来：会话哪怕没有任何输出，也留下「何时连过哪台机器」的记录
    this.send(this.header('开始'))
  }

  /** 喂一块终端输出 */
  push(chunk: string): void {
    if (this.closed || this.failed) return
    const { plain, rest } = drainEscapes(this.carry + chunk)
    this.carry = rest.length > MAX_CARRY ? '' : rest
    const text = cleanControl(plain)
    if (!text) return

    this.buffer += text
    if (this.buffer.length >= this.flushChars) {
      this.flush()
    } else if (this.timer === undefined) {
      this.timer = this.setTimer(() => {
        this.timer = undefined
        this.flush()
      }, this.flushMs)
    }
  }

  /** 会话结束：把剩下的写完并补上结束时间 */
  async close(): Promise<void> {
    if (this.closed) return this.pending
    this.closed = true
    this.cancelTimer()
    this.carry = ''
    this.flush()
    this.send(this.header('结束'))
    await this.pending
  }

  private header(label: '开始' | '结束'): string {
    const date = this.now()
    const clock = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    const lines = [`# ${label}: ${clock}`]
    if (label === '开始') {
      lines.unshift('# iTerminal 会话日志', `# 连接: ${this.meta.name} (${this.meta.user}@${this.meta.host}:${this.meta.port})`)
    }
    return lines.join('\n') + '\n'
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer)
      this.timer = undefined
    }
  }

  private flush(): void {
    this.cancelTimer()
    if (!this.buffer) return
    const chunk = this.buffer
    this.buffer = ''
    this.send(chunk)
  }

  private send(chunk: string): void {
    if (this.failed) return
    this.pending = this.pending
      .then(() => this.options.write(this.path, chunk))
      .catch(error => {
        if (this.failed) return
        this.failed = true
        this.buffer = ''
        this.cancelTimer()
        this.options.onError?.(error)
      })
  }
}
