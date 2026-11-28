import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionLogger, drainEscapes, sessionLogFileName, toPlainLogText, type SessionMeta } from '../sessionLog'

const meta: SessionMeta = { name: '生产 web/01', host: '10.0.0.5', port: 22, user: 'deploy' }

function setup(options: Partial<ConstructorParameters<typeof SessionLogger>[2]> = {}) {
  const writes: string[] = []
  const paths: string[] = []
  const onError = vi.fn()
  const logger = new SessionLogger('~/iTerminal/logs/', meta, {
    write: async (path, content) => {
      paths.push(path)
      writes.push(content)
    },
    now: () => new Date(2026, 10, 28, 21, 5, 9),
    ...options,
    onError,
  } as ConstructorParameters<typeof SessionLogger>[2])
  return { logger, writes, paths, onError }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('会话日志文本处理', () => {
  it('去掉颜色、光标移动、OSC 标题/超链接和其它转义', () => {
    const raw = '\x1b[1;32mOK\x1b[0m \x1b]0;title\x07\x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\ \x1b[2K\x1b[1;1H\x1b(Bend\x1b7\x1b8'
    expect(toPlainLogText(raw)).toBe('OK link end')
  })

  it('换行统一，回车、退格、响铃等控制字符去掉', () => {
    expect(toPlainLogText('a\r\nb\rc\x08\x07\t d\x00')).toBe('a\nb\nc\t d')
  })

  it('结尾没收完整的转义序列留到下一块', () => {
    expect(drainEscapes('ab\x1b[31')).toEqual({ plain: 'ab', rest: '\x1b[31' })
    expect(drainEscapes('ab\x1b]0;ti')).toEqual({ plain: 'ab', rest: '\x1b]0;ti' })
    expect(drainEscapes('ab\x1b')).toEqual({ plain: 'ab', rest: '\x1b' })
    // 完整的不留
    expect(drainEscapes('ab\x1b[31m').rest).toBe('')
  })

  it('文件名：路径末尾的斜杠去掉，名字里的非法字符换成下划线', () => {
    const path = sessionLogFileName('~/iTerminal/logs/', meta, new Date(2026, 10, 28, 21, 5, 9), 'ab12')
    expect(path).toBe('~/iTerminal/logs/生产_web_01_10.0.0.5_20261128_210509_ab12.log')
    expect(sessionLogFileName('/tmp/x', { name: '???', host: '', port: 22, user: '' }, new Date(2020, 0, 2, 3, 4, 5), 's'))
      .toBe('/tmp/x/session_session_20200102_030405_s.log')
  })
})

describe('SessionLogger', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('创建时写文件头；输出先进缓冲，到时间才写', async () => {
    const { logger, writes, paths } = setup()
    await settle()
    expect(paths[0]).toMatch(/生产_web_01_10\.0\.0\.5_20261128_210509_[0-9a-f]{4}\.log$/)
    expect(writes).toEqual(['# iTerminal 会话日志\n# 连接: 生产 web/01 (deploy@10.0.0.5:22)\n# 开始: 2026-11-28 21:05:09\n'])

    logger.push('\x1b[32mhello\x1b[0m\r\n')
    await settle()
    expect(writes).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toBe('hello\n')
  })

  it('攒够阈值立即写；连续输出按顺序、各写各的块', async () => {
    const { logger, writes } = setup({ flushChars: 10, flushMs: 60_000 })
    await settle()
    logger.push('12345')
    await settle()
    expect(writes).toHaveLength(1)
    // 第二块一到攒够阈值，立即写出前两块；之后的继续等定时器
    logger.push('67890')
    logger.push('abc')
    await settle()
    expect(writes.slice(1)).toEqual(['1234567890'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes.slice(1)).toEqual(['1234567890', 'abc'])
  })

  it('跨块的转义序列不会漏进日志', async () => {
    const { logger, writes } = setup({ flushChars: 1 })
    await settle()
    logger.push('ok \x1b[3')
    logger.push('1mred\x1b[0m\n')
    await settle()
    expect(writes.slice(1).join('')).toBe('ok red\n')
  })

  it('close 把剩下的写完并补结束标记；之后的输出不再记录', async () => {
    const { logger, writes } = setup({ flushMs: 60_000 })
    logger.push('tail\n')
    await logger.close()
    expect(writes.slice(1)).toEqual(['tail\n', '# 结束: 2026-11-28 21:05:09\n'])
    logger.push('late\n')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(writes).toHaveLength(3)
  })

  it('写盘失败只报告一次，随后停止记录', async () => {
    const onError = vi.fn()
    let calls = 0
    const logger = new SessionLogger('~/logs', meta, {
      write: async () => {
        calls++
        throw new Error('EACCES')
      },
      onError,
    })
    await settle()
    logger.push('more\n')
    await logger.close()
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    // 第一次失败后不再尝试写盘
    expect(calls).toBe(1)
  })

  it('没有任何输出也会留下「何时连过」的记录', async () => {
    const { logger, writes } = setup()
    await logger.close()
    expect(writes.join('')).toContain('# 开始: 2026-11-28 21:05:09')
    expect(writes.join('')).toContain('# 结束: 2026-11-28 21:05:09')
  })
})
