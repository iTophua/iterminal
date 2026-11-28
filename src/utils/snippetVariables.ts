import { stringWidth } from './ghostTextEngine'

/**
 * 片段里的变量与占位。语法是 {{名字}}，不与 shell 的 $VAR 冲突——
 * 片段里照样可以写 $HOME、$1 这些交给远端 shell 去展开。
 *
 * - {{host}} {{port}} {{user}} {{name}}：当前连接的信息
 * - {{date}} {{time}} {{datetime}} {{timestamp}} {{uuid}}：插入时生成
 * - {{cursor}}：标记插入后光标停在哪；它后面的内容照常写进去，但光标留在原处
 * - {{input:提示语}}：插入前弹窗让用户补一个值
 */

export interface SnippetContext {
  host?: string
  port?: number
  user?: string
  name?: string
  now?: Date
  uuid?: () => string
  /** {{input:…}} 的回答，按出现顺序 */
  inputs?: string[]
}

export interface RenderedSnippet {
  /** {{cursor}} 之前的内容 */
  before: string
  /** {{cursor}} 之后的内容 */
  after: string
}

const TOKEN = /\{\{\s*(?:input:([\s\S]*?)|([a-z]+))\s*\}\}/gi

const pad = (value: number) => String(value).padStart(2, '0')

function expand(text: string, ctx: SnippetContext, nextInput: () => string): string {
  const now = ctx.now ?? new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return text.replace(TOKEN, (token, prompt: string | undefined, name: string | undefined) => {
    if (prompt !== undefined) return nextInput()
    switch ((name ?? '').toLowerCase()) {
      case 'host':
        return ctx.host ?? ''
      case 'port':
        return String(ctx.port ?? 22)
      case 'user':
        return ctx.user ?? ''
      case 'name':
        return ctx.name ?? ''
      case 'date':
        return date
      case 'time':
        return time
      case 'datetime':
        return `${date} ${time}`
      case 'timestamp':
        return String(Math.floor(now.getTime() / 1000))
      case 'uuid':
        return (ctx.uuid ?? (() => crypto.randomUUID()))()
      case 'cursor':
        return ''
      // 不认识的名字原样保留，不替用户做主
      default:
        return token
    }
  })
}

/** 片段里所有 {{input:提示语}} 的提示语，按出现顺序 */
export function findInputPrompts(command: string): string[] {
  const prompts: string[] = []
  for (const match of command.matchAll(TOKEN)) {
    if (match[1] !== undefined) prompts.push(match[1].trim() || '请输入')
  }
  return prompts
}

export function renderSnippet(command: string, ctx: SnippetContext = {}): RenderedSnippet {
  // 回答按整条片段里的出现顺序取用：光标前后的占位共用一个队列
  const inputs = [...(ctx.inputs ?? [])]
  const nextInput = () => inputs.shift() ?? ''

  const cursor = /\{\{\s*cursor\s*\}\}/i.exec(command)
  if (!cursor) return { before: expand(command, ctx, nextInput), after: '' }
  const head = command.slice(0, cursor.index)
  const tail = command.slice(cursor.index + cursor[0].length)
  return { before: expand(head, ctx, nextInput), after: expand(tail, ctx, nextInput) }
}

/**
 * 把内容写进终端后让光标回到 {{cursor}} 处的按键序列（左方向键）。
 * 只对 bash/zsh 的行编辑有效；一次性写完再退格比先写一半更不容易和回显抢时序。
 */
export function cursorBackKeys(after: string): string {
  return '\x1b[D'.repeat(stringWidth(after))
}
