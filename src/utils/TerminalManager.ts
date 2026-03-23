import { Terminal as XTerm, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import type { FitAddon as FitAddonType } from '@xterm/addon-fit'
import type { SearchAddon as SearchAddonType } from '@xterm/addon-search'

export interface TerminalConfig extends Partial<ITerminalOptions> {
  fontSize: number
  fontFamily: string
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}

export class TerminalInstance {
  public readonly id: string
  public readonly xterm: XTerm
  public readonly fitAddon: FitAddonType
  public readonly searchAddon: SearchAddonType
  public resizeObserver?: ResizeObserver

  private disposed = false

  constructor(
    id: string,
    config: TerminalConfig,
    onResize?: (cols: number, rows: number) => void,
    onSelectionChange?: () => void,
    onWrite?: (data: string) => void
  ) {
    this.id = id

    this.xterm = new XTerm({
      cursorBlink: config.cursorBlink,
      cursorStyle: config.cursorStyle,
      fontSize: config.fontSize,
      fontFamily: `${config.fontFamily}, Menlo, Monaco, "Courier New", monospace`,
      convertEol: true,
      disableStdin: false,
      scrollback: config.scrollback,
      macOptionIsMeta: true,
      theme: config.theme,
    })

    this.fitAddon = new FitAddon()
    this.xterm.loadAddon(this.fitAddon)

    this.searchAddon = new SearchAddon()
    this.xterm.loadAddon(this.searchAddon)

    if (onResize) {
      this.xterm.onResize(({ cols, rows }) => {
        if (!this.disposed) {
          onResize(cols, rows)
        }
      })
    }

    if (onSelectionChange) {
      this.xterm.onSelectionChange(onSelectionChange)
    }

    if (onWrite) {
      this.xterm.onData(onWrite)
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.disposed) {
        this.fitAddon.fit()
      }
    })
  }

  attach(container: HTMLElement): void {
    container.innerHTML = ''
    this.xterm.open(container)
  }

  write(data: string): void {
    if (!this.disposed) {
      this.xterm.write(data)
    }
  }

  clear(): void {
    if (!this.disposed) {
      this.xterm.clear()
    }
  }

  selectAll(): void {
    if (!this.disposed) {
      this.xterm.selectAll()
    }
  }

  getSelection(): string {
    if (this.disposed) return ''
    return this.xterm.getSelection()
  }

  hasSelection(): boolean {
    if (this.disposed) return false
    return this.xterm.hasSelection()
  }

  focus(): void {
    if (!this.disposed) {
      this.xterm.focus()
    }
  }

  refresh(): void {
    if (!this.disposed) {
      this.xterm.refresh(0, this.xterm.rows - 1)
    }
  }

  setOption<K extends keyof ITerminalOptions>(key: K, value: ITerminalOptions[K]): void {
    if (!this.disposed) {
      this.xterm.options[key] = value
    }
  }

  observeResize(container: HTMLElement): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.disposed) {
          this.fitAddon.fit()
        }
      })
      this.resizeObserver.observe(container)
    }
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }
    this.xterm.dispose()
  }

  isDisposed(): boolean {
    return this.disposed
  }
}

export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>()

  get(id: string): TerminalInstance | undefined {
    return this.terminals.get(id)
  }

  has(id: string): boolean {
    return this.terminals.has(id)
  }

  add(terminal: TerminalInstance): void {
    this.terminals.set(terminal.id, terminal)
  }

  remove(id: string): boolean {
    const terminal = this.terminals.get(id)
    if (terminal) {
      terminal.dispose()
      this.terminals.delete(id)
      return true
    }
    return false
  }

  disposeAll(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose()
    }
    this.terminals.clear()
  }

  getAll(): TerminalInstance[] {
    return Array.from(this.terminals.values())
  }

  count(): number {
    return this.terminals.size
  }
}

// 全局终端管理器实例
export const terminalManager = new TerminalManager()
