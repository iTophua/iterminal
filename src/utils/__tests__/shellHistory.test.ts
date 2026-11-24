import { describe, it, expect } from 'vitest'
import { parseShellHistory, buildImportedHistory, MAX_IMPORTED_HISTORY } from '../shellHistory'
import type { ShellHistoryFile } from '../shellHistory'
import { findSuggestions } from '../../services/historyService'

const DAY = 24 * 60 * 60 * 1000

function file(name: string, content: string, extra: Partial<ShellHistoryFile> = {}): ShellHistoryFile {
  return { name, content, mtime: null, truncated: false, ...extra }
}

const own = (text: string, timestamp: number, count = 1) => ({ text, timestamp, count })

describe('parseShellHistory', () => {
  it('bash：一行一条', () => {
    expect(parseShellHistory(file('.bash_history', 'docker ps -a\ndocker logs -f\n\n'))).toEqual([
      { text: 'docker ps -a', time: null },
      { text: 'docker logs -f', time: null },
    ])
  })

  it('bash 开了 HISTTIMEFORMAT：#时间戳 行属于下一条命令', () => {
    const content = '#1700000000\ndocker ps -a\n#1700000100\ndocker logs -f\n'
    expect(parseShellHistory(file('.bash_history', content))).toEqual([
      { text: 'docker ps -a', time: 1700000000 },
      { text: 'docker logs -f', time: 1700000100 },
    ])
  })

  it('zsh EXTENDED_HISTORY：带元信息，多行命令以反斜杠续行', () => {
    const content = ': 1700000000:0;docker ps -a\n: 1700000100:5;tail -f app.log \\\n--lines=100 | grep error\n: 1700000200:1;cd /var\n'
    expect(parseShellHistory(file('.zsh_history', content))).toEqual([
      { text: 'docker ps -a', time: 1700000000 },
      { text: 'tail -f app.log --lines=100 | grep error', time: 1700000100 },
      { text: 'cd /var', time: 1700000200 },
    ])
  })

  it('只截了文件末尾时，首行可能不完整，丢弃', () => {
    expect(parseShellHistory(file('.bash_history', 'cker ps -a\ndocker logs -f\n', { truncated: true }))).toEqual([
      { text: 'docker logs -f', time: null },
    ])
  })

  it('CRLF 换行', () => {
    expect(parseShellHistory(file('.bash_history', 'docker ps -a\r\ndocker logs -f\r\n'))).toEqual([
      { text: 'docker ps -a', time: null },
      { text: 'docker logs -f', time: null },
    ])
  })
})

describe('buildImportedHistory', () => {
  const now = Date.UTC(2026, 10, 24)

  it('过滤太短的、黑名单里的、带明文凭据的、带控制字符的、超长的命令', () => {
    const imported = buildImportedHistory(
      [file('.bash_history', [
        'ls',
        'cd',
        'clear',
        'cd /var/log',
        'docker ps -a',
        'mysql -uroot --password=123456',
        'export GITHUB_TOKEN=ghp_xxx',
        'kubectl get secret db',
        'echo "a\x01b"',
        'x'.repeat(301),
        'echo done',
      ].join('\n'))],
      [],
      now,
    )
    // kubectl get secret 只是读 secret 对象，不是凭据，照常导入
    expect(imported.map(r => r.text)).toEqual(['echo done', 'kubectl get secret db', 'docker ps -a', 'cd /var/log'])
  })

  it('同一命令出现多次只算一条，位置按最后一次', () => {
    const imported = buildImportedHistory(
      [file('.bash_history', 'docker ps -a\ndocker logs -f\ndocker ps -a\n')],
      [],
      now,
    )
    expect(imported.map(r => r.text)).toEqual(['docker ps -a', 'docker logs -f'])
  })

  it('本应用历史里已有的命令不再导入', () => {
    const imported = buildImportedHistory(
      [file('.bash_history', 'docker ps -a\ndocker logs -f\n')],
      ['docker ps -a'],
      now,
    )
    expect(imported.map(r => r.text)).toEqual(['docker logs -f'])
  })

  it('新 → 旧；多个文件按修改时间排，文件内越靠后越新', () => {
    const imported = buildImportedHistory(
      [
        file('.bash_history', 'bash-old\nbash-new\n', { mtime: 100 }),
        file('.zsh_history', 'zsh-old\nzsh-new\n', { mtime: 200 }),
      ],
      [],
      now,
    )
    expect(imported.map(r => r.text)).toEqual(['zsh-new', 'zsh-old', 'bash-new', 'bash-old'])
  })

  it('记了执行时间的用真实时间；没记的排在 30 天前、依次再往前', () => {
    const imported = buildImportedHistory(
      [file('.zsh_history', ': 1700000000:0;timed-old\n: 1763900000:0;timed-new\nuntimed\n')],
      [],
      now,
    )
    const byText = new Map(imported.map(r => [r.text, r]))
    expect(byText.get('timed-old')?.timestamp).toBe(1700000000 * 1000)
    expect(byText.get('timed-new')?.timestamp).toBe(1763900000 * 1000)
    expect(byText.get('untimed')?.timestamp).toBe(now - 30 * DAY)
    expect(imported.every(r => r.count === 0)).toBe(true)
  })

  it('超过上限时只保留最新的那些', () => {
    const lines = Array.from({ length: MAX_IMPORTED_HISTORY + 500 }, (_, i) => `cmd-${String(i).padStart(5, '0')}`)
    const imported = buildImportedHistory([file('.bash_history', lines.join('\n'))], [], now)
    expect(imported).toHaveLength(MAX_IMPORTED_HISTORY)
    expect(imported[0].text).toBe(`cmd-${String(MAX_IMPORTED_HISTORY + 499).padStart(5, '0')}`)
  })

  it('作为命令提示候选：按新近度参与排序，与来源无关', () => {
    const appHistory = [own('docker ps -a', now - 20 * DAY, 1)]
    const imported = buildImportedHistory(
      [
        file(
          '.zsh_history',
          `: ${Math.floor((now - 40 * DAY) / 1000)}:0;docker logs -f\n: ${Math.floor((now - DAY) / 1000)}:0;docker exec -it\n`,
        ),
      ],
      [],
      now,
    )
    // 昨天在服务器上别的终端里用过的排最前；40 天前的过时效窗口，落在本应用历史之后
    expect(findSuggestions('docker ', appHistory, imported)).toEqual(['exec -it', 'ps -a', 'logs -f'])
  })

  it('没记时间的导入历史排在有使用记录的本应用历史之后', () => {
    const appHistory = [own('docker ps -a', now - 20 * DAY, 1)]
    const imported = buildImportedHistory([file('.bash_history', 'docker logs -f\ndocker exec -it\n')], [], now)
    expect(findSuggestions('docker ', appHistory, imported)).toEqual(['ps -a', 'exec -it', 'logs -f'])
  })
})
