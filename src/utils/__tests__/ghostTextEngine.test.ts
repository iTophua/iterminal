import { describe, it, expect } from 'vitest'
// 用真实的 xterm 缓冲区当「屏幕」：测试里模拟 shell 回显，驱动引擎读屏
import { Terminal } from '@xterm/xterm'
import { GhostTextEngine, layoutGhostLines, stringWidth } from '../ghostTextEngine'
import { findSuggestions } from '../../services/historyService'
import type { CommandRecord } from '../../types/history'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_RIGHT = '\x1b[C'
const KEY_LEFT = '\x1b[D'

const HISTORY = [
  'docker ps -a',
  'docker logs -f',
  'docker exec -it',
  'tail -f /var/log/app.log',
  'tail -F /var/log/syslog',
  'cd /data/App/Logs',
  'docker ps -a | grep nginx',
]

function write(term: Terminal, data: string): Promise<void> {
  return new Promise(resolve => term.write(data, () => resolve()))
}

/** 会回显的假 shell + 引擎：按键先经引擎处理，shell 改写命令行并重绘，再 sync */
class Sim {
  readonly term: Terminal
  readonly engine: GhostTextEngine
  /** shell 端当前的命令行 */
  line = ''
  private readonly prompt: string
  /** 提示符所在的绝对行号；测试里手动把提示符重绘到别的行后要同步修改 */
  promptRow = 0

  constructor(history: string[] = HISTORY, cols = 40, rows = 5, prompt = '$ ') {
    this.term = new Terminal({ cols, rows, scrollback: 50 })
    this.prompt = prompt
    const records: CommandRecord[] = history.map((text, i) => ({ text, timestamp: Date.now() - i * 1000, count: 1 }))
    this.engine = new GhostTextEngine(this.term, {
      getSuggestions: input => findSuggestions(input, records),
    })
  }

  /** shell 打出提示符 */
  private async printPrompt(): Promise<void> {
    await write(this.term, this.prompt)
    this.promptRow = this.term.buffer.active.baseY + this.term.buffer.active.cursorY
  }

  /** 连接后的初始状态 */
  async start(): Promise<void> {
    await this.printPrompt()
  }

  /** 先打出 prefix（上一条命令的输出），再在末尾打出新提示符 */
  async newPrompt(prefix = ''): Promise<void> {
    if (prefix) await write(this.term, prefix)
    await this.printPrompt()
  }

  send(data: string) {
    return this.engine.handleInput(data)
  }

  /**
   * shell 重绘命令行（readline 回显），光标落在行尾。
   * 命令行可能折成多行：先回到提示符所在行，清掉其后的内容再整体重画。
   */
  private async echo(): Promise<void> {
    const buf = this.term.buffer.active
    const up = buf.baseY + buf.cursorY - this.promptRow
    await write(this.term, '\x1b[A'.repeat(up) + '\r\x1b[J' + this.prompt + this.line)
    this.engine.sync()
  }

  /** 逐字符输入，每个字符都等到回显 */
  async type(text: string): Promise<void> {
    for (const ch of text) {
      this.send(ch)
      this.line += ch
      await this.echo()
    }
  }

  /** shell 把命令行重绘为 line */
  async redraw(line: string): Promise<void> {
    this.line = line
    await this.echo()
  }

  /** 按一个由 shell 改写命令行的键；after 负责改 this.line */
  async key(data: string, after?: () => void): Promise<void> {
    this.send(data)
    after?.()
    await this.echo()
  }

  /** 回车执行，shell 换行打出新提示符 */
  async enter(): Promise<void> {
    this.send('\r')
    this.line = ''
    await write(this.term, '\r\n')
    await this.printPrompt()
    this.engine.sync()
  }

  get view() {
    return this.engine.view
  }
}

describe('GhostTextEngine', () => {
  it('输入时按历史前缀给建议，起点在光标处', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    expect(s.view).toMatchObject({ text: 's -a', row: 0, col: 10 })
  })

  it('Tab 补全后按补全后的整行继续提示', async () => {
    const s = new Sim()
    await s.start()
    await s.type('doc')
    expect(s.view?.text).toBe('ker ps -a')

    await s.key('\t', () => { s.line = 'docker ' })
    expect(s.view).toMatchObject({ text: 'ps -a', row: 0, col: 9 })

    await s.type('l')
    expect(s.view).toMatchObject({ text: 'ogs -f', row: 0, col: 10 })

    // → 接受建议
    expect(s.send(KEY_RIGHT)).toEqual({ type: 'accept', text: 'ogs -f' })
    expect(s.view).toBeNull()
  })

  it('Tab 没有补全出内容时不再提示，直到命令行有变化', async () => {
    const s = new Sim()
    await s.start()
    await s.type('do')
    expect(s.view?.text).toBe('cker ps -a')
    // 歧义补全：bash 只响铃，命令行不变
    await s.key('\t')
    expect(s.view).toBeNull()
    await s.type('c')
    expect(s.view?.text).toBe('ker ps -a')
  })

  it('Tab 之后立刻继续输入（补全回显还没到）也不会接错', async () => {
    const s = new Sim()
    await s.start()
    await s.type('doc')

    s.send('\t')
    s.send('l')
    s.line = 'docker '
    await write(s.term, '\r\x1b[K$ docker ')
    s.engine.sync()
    // 补全刚回显：按补全后的整行给建议
    expect(s.view?.text).toBe('ps -a')

    s.line = 'docker l'
    await write(s.term, 'l')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'ogs -f', col: 10 })
  })

  it('↑ 调出历史命令后不提示，继续输入时按整行提示', async () => {
    const s = new Sim()
    await s.start()
    await s.key(KEY_UP, () => { s.line = 'docker ps -a' })
    expect(s.view).toBeNull()

    await s.type(' ')
    expect(s.view).toMatchObject({ text: '| grep nginx', row: 0, col: 15 })

    await s.key(KEY_DOWN, () => { s.line = '' })
    expect(s.view).toBeNull()
  })

  it('空行直接按 ↑ 调出历史，再继续输入也能按整行提示', async () => {
    const s = new Sim()
    await s.start()
    await s.key(KEY_UP, () => { s.line = 'docker logs -f' })
    await s.type(' ')
    expect(s.view).toBeNull()

    await s.key(KEY_UP, () => { s.line = 'docker ps -a' })
    expect(s.view).toBeNull()
    await s.type(' |')
    expect(s.view).toMatchObject({ text: ' grep nginx', col: 16 })
  })

  it('粘贴不经过按键路径，回显后同样对齐', async () => {
    const s = new Sim()
    await s.start()
    // 空行上粘贴
    s.engine.noteExternalWrite()
    s.line = 'docker lo'
    await write(s.term, 'docker lo')
    s.engine.sync()
    expect(s.view?.text).toBe('gs -f')

    // 已有输入时再粘贴
    s.engine.noteExternalWrite()
    s.line = 'docker logs -f /var/'
    await write(s.term, 'gs -f /var/')
    s.engine.sync()
    expect(s.view).toBeNull()
    await s.type('l')
    expect(s.view).toBeNull()
  })

  it('历史弹窗选中的命令回显后视同调出历史：不接延伸建议，编辑后恢复', async () => {
    const s = new Sim()
    await s.start()
    s.engine.noteExternalWrite(true)
    s.line = 'docker ps -a'
    await write(s.term, 'docker ps -a')
    s.engine.sync()
    expect(s.view).toBeNull()

    await s.type(' ')
    expect(s.view?.text).toBe('| grep nginx')
  })

  it('Ctrl+W 删掉最后一个词后按删后的命令行提示', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker logs')
    expect(s.view?.text).toBe(' -f')
    await s.key('\x17', () => { s.line = 'docker ' })
    expect(s.view?.text).toBe('ps -a')
  })

  it('光标移到行中间后不提示，此时 → 是移动光标而不是插入建议', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    expect(s.view?.text).toBe('s -a')

    s.send(KEY_LEFT)
    await write(s.term, KEY_LEFT)
    s.engine.sync()
    expect(s.view).toBeNull()

    expect(s.send(KEY_RIGHT)).toEqual({ type: 'pass' })
    await write(s.term, KEY_RIGHT)
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a', col: 10 })
  })

  it('光标在行中间时继续输入：按光标前内容追踪，但不显示', async () => {
    const s = new Sim(['docker ps -a'])
    await s.start()
    await s.type('docker ps')
    expect(s.view?.text).toBe(' -a')

    // ← 一次：光标落在 p 和 s 之间
    s.send(KEY_LEFT)
    await write(s.term, KEY_LEFT)
    s.engine.sync()
    expect(s.view).toBeNull()

    // 插入 x，shell 把光标放回 s 前面
    s.send('x')
    s.line = 'docker pxs'
    await write(s.term, '\r\x1b[K$ docker pxs\x08')
    s.engine.sync()
    expect(s.view).toBeNull()

    // 退格删掉 x：又回到 docker ps（readline 退一格、擦到行尾、重画 s、光标放回原处）
    s.send('\x7f')
    s.line = 'docker ps'
    await write(s.term, '\x08\x1b[Js\x08')
    s.engine.sync()
    expect(s.view).toBeNull()

    // End 回到行尾，按整行给建议
    s.send('\x1b[F')
    await write(s.term, KEY_RIGHT)
    s.engine.sync()
    expect(s.view).toMatchObject({ text: ' -a', col: 11 })
  })

  it('Esc 只关闭建议、不发给 shell；没有建议时透传', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    expect(s.send('\x1b')).toEqual({ type: 'swallow' })
    expect(s.view).toBeNull()
    expect(s.send('\x1b')).toEqual({ type: 'pass' })
  })

  it('回车后重置，下一行从新提示符处重新开始', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    await s.enter()
    expect(s.view).toBeNull()
    await s.type('d')
    expect(s.view).toMatchObject({ text: 'ocker ps -a', row: 1, col: 3 })
  })

  it('Ctrl+C 后重置', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    s.send('\x03')
    s.line = ''
    await s.newPrompt('^C\r\n')
    s.engine.sync()
    expect(s.view).toBeNull()
    await s.type('d')
    expect(s.view).toMatchObject({ text: 'ocker ps -a', row: 1, col: 3 })
  })

  it('本行还没被回显确认前不显示（先敲两个键、回显未到）', async () => {
    const s = new Sim()
    await s.start()
    s.send('d')
    s.send('o')
    s.engine.sync()
    expect(s.view).toBeNull()

    s.line = 'd'
    await write(s.term, 'd')
    s.engine.sync()
    expect(s.view).toBeNull()

    s.line = 'do'
    await write(s.term, 'o')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'cker ps -a', col: 4 })
  })

  it('回显没跟上时按预测显示，不退回旧的屏幕内容', async () => {
    const s = new Sim()
    await s.start()
    await s.type('d')
    expect(s.view?.text).toBe('ocker ps -a')

    s.send('o')
    s.send('c')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'ker ps -a', col: 5 })

    // 屏幕只跟到 do：保持预测值
    s.line = 'do'
    await write(s.term, 'o')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'ker ps -a', col: 5 })

    s.line = 'doc'
    await write(s.term, 'c')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'ker ps -a', col: 5 })
  })

  it('退格后滞后到达的旧回显不会把建议带回旧状态', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker lo')
    expect(s.view?.text).toBe('gs -f')

    s.send('\x7f')
    s.send('\x7f')
    s.send('p')
    s.engine.sync()
    expect(s.view?.text).toBe('s -a')

    // 回显依次经过 docker l、docker ：都是自己按键的旧状态，不该采纳
    s.line = 'docker l'
    await write(s.term, '\x08 \x08')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a', col: 10 })
    s.line = 'docker '
    await write(s.term, '\x08 \x08')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a', col: 10 })

    s.line = 'docker p'
    await write(s.term, 'p')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a', col: 10 })
  })

  it('不回显的输入（密码提示）不出现建议', async () => {
    const s = new Sim()
    await write(s.term, '[sudo] password for ops: ')
    s.send('p')
    s.send('a')
    s.send('s')
    s.engine.sync()
    expect(s.view).toBeNull()
    expect(s.send(KEY_RIGHT)).toEqual({ type: 'pass' })
  })

  it('光标右侧隔着空白另有内容（zsh 右侧提示符）：仍算行尾，建议首行停在它前面', async () => {
    const s = new Sim(['docker ps -a --all'], 20, 5)
    await s.start()
    await s.type('docker p')
    // 右侧提示符靠右画在第 15~19 列，画完把光标放回命令行末尾（第 10 列）
    await write(s.term, '\x1b[16G12:34\x1b[11G')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a --all', col: 10, endCol: 15 })
    // 首行只能排到第 15 列前：s -a␣｜-all
    expect(layoutGhostLines(s.view!.text, s.view!.col, 20, 5, s.view!.endCol)).toEqual(['s -a ', '--all'])

    // 没有右侧提示符时上限就是终端列数
    const plain = new Sim(['docker ps -a --all'], 20, 5)
    await plain.start()
    await plain.type('docker p')
    expect(plain.view?.endCol).toBe(20)
  })

  it('光标右侧的内容紧挨着光标或只隔一格：光标在文字中间，不算行尾', async () => {
    const s = new Sim(['docker ps -a --all'], 20, 5)
    await s.start()
    await s.type('docker p')

    // 服务器上的 zsh-autosuggestions 之类贴着光标画的建议
    await write(s.term, 's -a\x1b[11G')
    s.engine.sync()
    expect(s.view).toBeNull()

    // 行内文字、光标后面只隔一格：不算行尾
    // （$ docker␣ → 光标在第 9 列；第 10 列空，第 11 列起有字）
    s.send('\x7f')
    await s.redraw('docker ')
    await write(s.term, '\x1b[11Gp ps\x1b[10G')
    s.engine.sync()
    expect(s.view).toBeNull()
    expect(s.send(KEY_RIGHT)).toEqual({ type: 'pass' })
  })

  it('中文按 2 格算，建议紧跟在光标后', async () => {
    const s = new Sim(['echo 你好世界', 'tail -f /var/log/app.log'])
    await s.start()
    await s.type('echo 你')
    // $ echo 你 = 2 + 5 + 4 格
    expect(s.view).toMatchObject({ text: '好世界', col: 9 })
    await s.type('好')
    expect(s.view).toMatchObject({ text: '世界', col: 11 })
  })

  it('退格删掉中文后位置跟着光标走', async () => {
    const s = new Sim(['echo 你好世界'])
    await s.start()
    await s.type('echo 你好')
    expect(s.view?.text).toBe('世界')

    // 退格删的是宽字符：readline 退 2 格、用空格擦掉、再退回来
    s.send('\x7f')
    s.line = 'echo 你'
    await write(s.term, '\x08\x08  \x08\x08')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: '好世界', col: 9 })
  })

  it('宽字符在行尾放不下、被挤到下一行时，行尾留的空格不算输入', async () => {
    const s = new Sim(['echo 你好世界'], 10, 5)
    await s.start()
    // $ echo 你_｜好世　（第 9 列留空，「好」整体换行）
    await s.type('echo 你好世')
    expect(s.view).toMatchObject({ text: '界', row: 1, col: 4 })
  })

  it('在候选间循环切换', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker')
    expect(s.view?.candidates).toEqual([' ps -a', ' logs -f', ' exec -it', ' ps -a | grep nginx'])
    expect(s.view?.text).toBe(' ps -a')

    s.engine.cycle(1)
    expect(s.view?.text).toBe(' logs -f')
    s.engine.cycle(-1)
    expect(s.view?.text).toBe(' ps -a')
    s.engine.cycle(-1)
    expect(s.view?.text).toBe(' ps -a | grep nginx')
    // 位置不变
    expect(s.view).toMatchObject({ row: 0, col: 8 })
  })

  it('建议保留历史命令的原始大小写', async () => {
    const s = new Sim(['cd /data/App/Logs'])
    await s.start()
    await s.type('cd /data/app/')
    expect(s.view?.text).toBe('Logs')
  })

  it('视口向上滚动时建议隐藏，滚回底部恢复', async () => {
    const s = new Sim()
    // 先刷几屏输出，让终端有可回滚的内容
    for (let i = 0; i < 8; i++) await write(s.term, 'line\r\n')
    await s.start()
    await s.type('docker p')
    expect(s.view?.text).toBe('s -a')

    s.term.scrollLines(-1)
    expect(s.view).toBeNull()
    s.term.scrollLines(1)
    expect(s.view?.text).toBe('s -a')
  })

  it('进入备用屏（vim/less 等）后重置', async () => {
    const s = new Sim()
    await s.start()
    await s.type('docker p')
    await write(s.term, '\x1b[?1049h')
    s.engine.sync()
    expect(s.view).toBeNull()
  })
})

describe('GhostTextEngine 行尾与折行', () => {
  it('输入正好占满一行：光标停在行尾，建议从下一行行首开始', async () => {
    const s = new Sim(['docker ps -a'], 11, 5)
    await s.start()
    await s.type('docker ps')
    expect(s.view).toMatchObject({ text: ' -a', row: 1, col: 0 })
    expect(layoutGhostLines(s.view!.text, s.view!.col, 11, 5 - s.view!.row)).toEqual([' -a'])
  })

  it('输入跨行（软换行）后建议仍跟在光标后', async () => {
    const s = new Sim(['docker ps -a --all'], 12, 5)
    await s.start()
    await s.type('docker ps -a')
    // $ docker ps ｜ -a
    expect(s.view).toMatchObject({ text: ' --all', row: 1, col: 2 })
  })

  it('跨行输入中途退格、继续输入都对齐', async () => {
    const s = new Sim(['docker ps -a --all'], 12, 5)
    await s.start()
    await s.type('docker ps -a')
    await s.key('\x7f', () => { s.line = 'docker ps -' })
    expect(s.view).toMatchObject({ text: 'a --all', row: 1, col: 1 })
    await s.type('a')
    expect(s.view).toMatchObject({ text: ' --all', row: 1, col: 2 })
  })

  it('光标停在最后一个字符上（← 回到行尾字符）不算在行尾', async () => {
    const s = new Sim(['docker ps -a'], 11, 5)
    await s.start()
    await s.type('docker ps')
    expect(s.view?.text).toBe(' -a')

    s.send(KEY_LEFT)
    await write(s.term, KEY_LEFT)
    s.engine.sync()
    expect(s.view).toBeNull()
  })

  it('命令正好占满一行：shell 把光标放在最后一列，仍按行尾处理，建议从下一行行首开始', async () => {
    // $ cd /var/log/ 正好 14 格
    const s = new Sim(['cd /var/log/', 'cd /var/log/nginx/'], 14, 5)
    await s.start()
    await s.type('cd /var/l')
    await s.key('\t', () => { s.line = 'cd /var/log/' })
    // shell 重绘满一行后，光标没法越过最后一列，只能停在最后一列的字符上
    await write(s.term, '\r\x1b[13C')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'nginx/', row: 1, col: 0 })
    expect(layoutGhostLines(s.view!.text, s.view!.col, 14, 5 - s.view!.row)).toEqual(['nginx/'])

    // 同一个位置，如果是 ← 移过来的：光标确实在 / 前面，不算行尾
    s.send(KEY_LEFT)
    await write(s.term, KEY_LEFT)
    s.engine.sync()
    expect(s.view).toBeNull()
  })

  it('建议超出终端底部的部分截掉', async () => {
    const s = new Sim(['docker ps -a --all'], 20, 5)
    // 上一条命令的输出填到倒数第二行，提示符落在最后一行
    await s.newPrompt('output\r\n'.repeat(4))
    await s.type('docker ps -')
    expect(s.view).toMatchObject({ text: 'a --all', row: 4, col: 13 })
    // 这一行还剩 7 格，下面没有行可折
    expect(layoutGhostLines(s.view!.text, s.view!.col, 20, 5 - s.view!.row)).toEqual(['a --all'])
    expect(layoutGhostLines('a --all --filter', 13, 20, 5 - s.view!.row)).toEqual(['a --all'])
  })
})

describe('GhostTextEngine 起点丢失后的恢复', () => {
  it('补全列出候选后整行被重绘到新行，起点重新定位', async () => {
    const s = new Sim()
    await s.start()
    await s.type('doc')
    // bash 第二次 Tab：列出候选，再在新行上重绘提示符 + 命令行
    s.send('\t')
    s.line = 'docker'
    await write(s.term, '\r\ndocker  docker-compose\r\n$ docker')
    s.promptRow = 2
    s.engine.sync()
    expect(s.view).toMatchObject({ text: ' ps -a', row: 2, col: 8 })

    await s.type(' ')
    expect(s.view).toMatchObject({ text: 'ps -a', row: 2, col: 9 })
  })

  it('补全改写了当前词并换行重绘（提示符格式不认识）也能定位', async () => {
    const s = new Sim(['cd /var/log/nginx/', 'cd /var/log/'], 40, 5, 'prod ❯ ')
    await s.start()
    await s.type('cd /var/l')
    expect(s.view?.text).toBe('og/nginx/')

    // zsh：列出候选，补全公共前缀，换行重绘
    s.send('\t')
    s.line = 'cd /var/log/'
    await write(s.term, '\r\nlog/  log/nginx/\r\nprod ❯ cd /var/log/')
    s.promptRow = 2
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'nginx/', row: 2, col: 19 })

    await s.type('n')
    expect(s.view).toMatchObject({ text: 'ginx/', row: 2, col: 20 })
  })

  it('Ctrl+L 清屏后 shell 在屏幕顶部重绘，起点重新定位', async () => {
    const s = new Sim()
    for (let i = 0; i < 3; i++) await write(s.term, 'output\r\n')
    await s.start()
    await s.type('docker p')
    expect(s.view?.text).toBe('s -a')

    s.send('\x0c')
    await write(s.term, '\x1b[H\x1b[2J$ docker p')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 's -a', row: 0, col: 10 })
  })

  it('窗口缩窄后这一行被截断：shell 重绘之前不显示，重绘之后恢复', async () => {
    const s = new Sim(['docker ps -a --all --filter x'], 40, 5)
    await s.start()
    await s.type('docker ps -a --all')
    expect(s.view?.text).toBe(' --filter x')

    // xterm 不重排光标所在行，缩窄后这一行只剩前 12 格
    s.term.resize(12, 5)
    await write(s.term, '')
    s.engine.noteResize()
    s.engine.sync()
    expect(s.view).toBeNull()

    // shell 收到窗口尺寸变化后重绘整行，命令折成两行
    await write(s.term, '\r\x1b[J$ docker ps -a --all')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: ' --filter x', row: 1, col: 8 })
    // 这一行只剩 4 格，建议折到下一行
    expect(layoutGhostLines(s.view!.text, s.view!.col, 12, 5 - s.view!.row)).toEqual([' --f', 'ilter x'])
  })

  it('窗口缩窄后 shell 还没重绘就继续输入：不再干等，重绘到达后对齐全行', async () => {
    const s = new Sim(['docker ps -a --all --filter x'], 40, 5)
    await s.start()
    await s.type('docker ps -a --all')
    s.term.resize(12, 5)
    await write(s.term, '')
    s.engine.noteResize()
    s.engine.sync()
    expect(s.view).toBeNull()

    // 行还是截断状态就接着敲：按屏幕上现有的（被截断的）内容重新建立起点
    s.send(' ')
    await write(s.term, ' ')
    s.engine.sync()
    // 敲进去的空格正好落在最后一列：光标停在行尾，建议从下一行行首开始
    expect(s.view).toMatchObject({ text: '-a --all --filter x', row: 1, col: 0 })

    // shell 重绘，整行回来了：自动采纳
    s.promptRow = 0
    await s.redraw('docker ps -a --all ')
    s.engine.sync()
    // $ docker ps ｜-a --all␣
    expect(s.view).toMatchObject({ text: '--filter x', row: 1, col: 9 })
    await s.type('-')
    expect(s.view).toMatchObject({ text: '-filter x', row: 1, col: 10 })
  })

  it('命令还在执行时提前敲的字符，提示符出现后也能对上', async () => {
    const s = new Sim()
    await write(s.term, '$ sleep 3\r\nworking')
    // 命令没结束就开始敲：按键被 TTY 缓冲
    s.send('d')
    s.send('o')
    // 命令结束，提示符打出，缓冲的按键回显
    await write(s.term, '\r\n$ do')
    s.engine.sync()
    expect(s.view).toMatchObject({ text: 'cker ps -a', row: 2, col: 4 })
  })
})

describe('layoutGhostLines / stringWidth', () => {
  it('按格数折行，首行从光标处起排', () => {
    // 首行从第 11 列起能放 9 格；放不下的空格照常落到下一行行首（与真实输入折行一致）
    expect(layoutGhostLines(' -a --all --filter name=nginx', 11, 20, 5)).toEqual([' -a --all', ' --filter name=nginx'])
    expect(layoutGhostLines(' -a', 17, 20, 5)).toEqual([' -a'])
    expect(layoutGhostLines(' -a', 18, 20, 5)).toEqual([' -', 'a'])
    expect(layoutGhostLines('abcdef', 18, 20, 2)).toEqual(['ab', 'cdef'])
    expect(layoutGhostLines('abcdef', 18, 20, 1)).toEqual(['ab'])
    expect(layoutGhostLines('abc', 18, 20, 0)).toEqual([])
    // 首行有自己的列上限时提前折行，之后各行恢复整行宽
    expect(layoutGhostLines('abcdef', 8, 20, 5, 10)).toEqual(['ab', 'cdef'])
  })

  it('宽字符放不下时整体挪到下一行', () => {
    // 第 19 列只剩 1 格，放不下「你」
    expect(layoutGhostLines('你好', 19, 20, 5)).toEqual(['', '你好'])
    expect(layoutGhostLines('你好世界', 17, 20, 5)).toEqual(['你', '好世界'])
  })

  it('stringWidth', () => {
    expect(stringWidth('abc')).toBe(3)
    expect(stringWidth('你好')).toBe(4)
    expect(stringWidth('e\u0301')).toBe(1)
    expect(stringWidth('a\u200Db')).toBe(2)
    expect(stringWidth('😀')).toBe(2)
  })
})

describe('findSuggestions', () => {
  const now = Date.now()
  const rec = (text: string, ageMs: number, count = 1): CommandRecord => ({ text, timestamp: now - ageMs, count })

  it('多来源按匹配度归并，重复的只留一条', () => {
    const own = [rec('docker ps -a', 20 * 86400000)]
    const imported = [rec('docker ps -a', 86400000), rec('docker logs -f', 2 * 86400000)]
    expect(findSuggestions('docker ', own, imported)).toEqual(['ps -a', 'logs -f'])
  })

  it('连续空白算一个空格，后缀接在原始命令上', () => {
    expect(findSuggestions('ls  -', [rec('ls -la', 0), rec('ls -lh', 1000)])).toEqual(['la', 'lh'])
  })

  it('与输入完全相同的命令不算候选', () => {
    expect(findSuggestions('docker ps -a', [rec('docker ps -a', 0)])).toEqual([])
    expect(findSuggestions('x', undefined)).toEqual([])
  })
})
