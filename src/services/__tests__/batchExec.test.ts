import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockInvoke } from '../../test/setup'
import { batchExecute, statusText, summarize, toCsv, type BatchExecResult } from '../batchExec'

const result = (patch: Partial<BatchExecResult>): BatchExecResult => ({
  id: 'id',
  label: 'web',
  success: true,
  output: '',
  error: null,
  timed_out: false,
  ...patch,
})

describe('batchExec service', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('batchExecute 把连接 id 和命令交给后端', async () => {
    const results = [result({})]
    mockInvoke.mockResolvedValueOnce(results)
    expect(await batchExecute(['a', 'b'], 'df -h')).toEqual(results)
    expect(mockInvoke).toHaveBeenCalledWith('batch_execute_command', { ids: ['a', 'b'], command: 'df -h' })
  })

  it('状态文案', () => {
    expect(statusText(result({ success: true }))).toBe('成功')
    expect(statusText(result({ success: false }))).toBe('失败')
    expect(statusText(result({ success: false, timed_out: true }))).toBe('超时')
  })

  it('汇总：成功数 + 每台的输出与错误', () => {
    const text = summarize([
      result({ label: 'web-1', output: '/dev/sda 40%\n' }),
      result({ label: 'web-2', success: false, error: '连接超时', output: '' }),
      result({ label: 'web-3', output: '   \n' }),
    ])
    // web-3 没有输出但命令成功了，也算成功
    expect(text.startsWith('成功 2 / 3\n')).toBe(true)
    expect(text).toContain('── web-1【成功】\n/dev/sda 40%\n')
    expect(text).toContain('── web-2【失败】\n连接超时')
    expect(text).toContain('── web-3【成功】\n（无输出）')
  })

  it('CSV：带 BOM，单元格里的引号、逗号、换行不破坏结构', () => {
    const csv = toCsv([
      result({ label: 'a,1', output: 'said "hi"\nline2' }),
      result({ label: 'b', success: false, error: 'boom' }),
    ])
    expect(csv.startsWith('\uFEFF"连接","状态","输出"\r\n')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('"a,1","成功","said ""hi""\nline2"')
    expect(lines[2]).toBe('"b","失败","boom"')
  })
})
