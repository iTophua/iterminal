import { invoke } from '@tauri-apps/api/core'

/**
 * 批量执行：在多条连接上并发跑同一条命令，汇总结果（后端 batch_exec.rs）。
 */

export interface BatchExecResult {
  id: string
  /** 连接名 */
  label: string
  success: boolean
  output: string
  error: string | null
  /** 命令超时被强制终止，output 含超时前已收到的输出 */
  timed_out: boolean
}

export function batchExecute(ids: string[], command: string): Promise<BatchExecResult[]> {
  return invoke<BatchExecResult[]>('batch_execute_command', { ids, command })
}

export function statusText(result: Pick<BatchExecResult, 'success' | 'timed_out'>): string {
  if (result.timed_out) return '超时'
  return result.success ? '成功' : '失败'
}

export function summarize(results: BatchExecResult[]): string {
  const ok = results.filter(result => result.success).length
  const lines = [`成功 ${ok} / ${results.length}`, '']
  for (const result of results) {
    lines.push(`── ${result.label}【${statusText(result)}】`)
    const detail = [result.error?.trimEnd(), result.output.trimEnd()].filter(Boolean).join('\n')
    lines.push(detail || '（无输出）', '')
  }
  return lines.join('\n')
}

/** CSV（带 BOM，Excel 直接打开不乱码）：连接,状态,输出 */
export function toCsv(results: BatchExecResult[]): string {
  const cell = (text: string) => `"${text.replace(/"/g, '""')}"`
  const rows = [['连接', '状态', '输出'].map(cell).join(',')]
  for (const result of results) {
    const detail = [result.error?.trimEnd(), result.output.trimEnd()].filter(Boolean).join('\n')
    rows.push([result.label, statusText(result), detail].map(cell).join(','))
  }
  return '\uFEFF' + rows.join('\r\n')
}

export function downloadCsv(results: BatchExecResult[], fileName: string): void {
  const url = URL.createObjectURL(new Blob([toCsv(results)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
