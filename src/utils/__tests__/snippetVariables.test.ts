import { describe, it, expect } from 'vitest'
import { renderSnippet, findInputPrompts, cursorBackKeys } from '../snippetVariables'

const ctx = {
  host: '10.0.0.5',
  port: 2222,
  user: 'deploy',
  name: '生产-web',
  now: new Date(2026, 10, 28, 9, 5, 7),
  uuid: () => 'uuid-1',
}

describe('片段变量', () => {
  it('连接信息与时间变量按当前上下文展开', () => {
    // 时间戳跟着构造的本地时间算，测试在哪个时区跑都一样
    const timestamp = Math.floor(ctx.now.getTime() / 1000)
    expect(
      renderSnippet('ssh {{user}}@{{host}} -p {{port}} # {{name}} {{date}} {{time}} {{datetime}} {{timestamp}} {{uuid}}', ctx).before,
    ).toBe(
      `ssh deploy@10.0.0.5 -p 2222 # 生产-web 2026-11-28 09:05:07 2026-11-28 09:05:07 ${timestamp} uuid-1`,
    )
    // 大小写不敏感、花括号里可以有空格
    expect(renderSnippet('{{ Host }}:{{PORT}}', ctx).before).toBe('10.0.0.5:2222')
  })

  it('shell 自己的 $VAR 原样保留，不认识的 {{名字}} 也不动', () => {
    const command = 'echo $USER $HOME $1 ${PATH} {{whatever}}'
    expect(renderSnippet(command, ctx).before).toBe(command)
  })

  it('{{cursor}} 之后的内容单独放到 after', () => {
    const rendered = renderSnippet('tail -n 500 {{name}}.log {{cursor}} | grep ERROR', ctx)
    expect(rendered.before).toBe('tail -n 500 生产-web.log ')
    expect(rendered.after).toBe(' | grep ERROR')
    // 没有 {{cursor}} 就全部在光标前
    expect(renderSnippet('ls', ctx)).toEqual({ before: 'ls', after: '' })
  })

  it('{{input:…}} 按整条片段里的出现顺序取回答，光标前后共用一个队列', () => {
    const command = 'cp {{input:源文件}} {{cursor}}{{input:目标文件}} && echo {{input:源文件}} done'
    expect(findInputPrompts(command)).toEqual(['源文件', '目标文件', '源文件'])
    const rendered = renderSnippet(command, { ...ctx, inputs: ['a.log', 'b.log', 'a.log'] })
    expect(rendered.before).toBe('cp a.log ')
    expect(rendered.after).toBe('b.log && echo a.log done')
    // 回答不够的占位留空
    expect(renderSnippet('{{input:未回答}}', ctx).before).toBe('')
  })

  it('空提示语有默认文案', () => {
    expect(findInputPrompts('rm {{input: }}')).toEqual(['请输入'])
  })

  it('光标回退按键数按显示宽度算', () => {
    expect(cursorBackKeys('| grep')).toBe('\x1b[D'.repeat(6))
    // 中文占两格
    expect(cursorBackKeys('日志')).toBe('\x1b[D'.repeat(4))
    expect(cursorBackKeys('')).toBe('')
  })
})
