import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal, type ModalFuncProps } from 'antd'
import { mockInvoke } from '../../test/setup'
import {
  connectSsh,
  connectAndCreateTerminal,
  testConnection,
  toSSHConnection,
  HostKeyDeclinedError,
} from '../ssh'
import { parseHostKeyChallenge, confirmHostKey, hostKeyFileHint, type HostKeyChallenge } from '../hostKey'
import { useTerminalStore } from '../../stores/terminalStore'

const NEW_KEY = { key_type: 'ssh-ed25519', key: 'AAAANEW', fingerprint: 'SHA256:new-key' }
const OLD_KEY = { key_type: 'ssh-ed25519', key: 'AAAAOLD', fingerprint: 'SHA256:old-key' }

const unknownChallenge: HostKeyChallenge = {
  kind: 'unknown',
  host: 'web1.example.com',
  port: 22,
  presented: NEW_KEY,
}
const changedChallenge: HostKeyChallenge = {
  kind: 'changed',
  host: 'web1.example.com',
  port: 2222,
  presented: NEW_KEY,
  trusted: OLD_KEY,
}

const toError = (challenge: HostKeyChallenge) => `HOST_KEY_CHALLENGE:${JSON.stringify(challenge)}`

const params = { host: 'web1.example.com', port: 22, username: 'root', password: 'pw', key_file: null }

describe('主机密钥挑战解析', () => {
  it('带前缀的错误串解析出挑战', () => {
    expect(parseHostKeyChallenge(toError(changedChallenge))).toEqual(changedChallenge)
  })

  it('普通错误、格式不对的都不是挑战', () => {
    expect(parseHostKeyChallenge('连接失败: refused')).toBeNull()
    expect(parseHostKeyChallenge('HOST_KEY_CHALLENGE:not json')).toBeNull()
    expect(parseHostKeyChallenge('HOST_KEY_CHALLENGE:{"kind":"weird"}')).toBeNull()
    expect(parseHostKeyChallenge(new Error('x'))).toBeNull()
    expect(parseHostKeyChallenge(undefined)).toBeNull()
  })
})

describe('hostKeyFileHint', () => {
  it('按密钥类型给出服务器上的公钥文件', () => {
    expect(hostKeyFileHint('ssh-ed25519')).toBe('ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub')
    expect(hostKeyFileHint('rsa-sha2-512')).toBe('ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub')
    expect(hostKeyFileHint('ecdsa-sha2-nistp256')).toBe('ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub')
  })
})

describe('connectSsh', () => {
  let dialogs: ModalFuncProps[]
  let answer: 'ok' | 'cancel'

  beforeEach(() => {
    dialogs = []
    answer = 'cancel'
    vi.spyOn(Modal, 'confirm').mockImplementation(options => {
      dialogs.push(options)
      // 确认框在真实环境里等用户点击；这里在下一个微任务里替用户作答
      queueMicrotask(() => (answer === 'ok' ? options.onOk?.() : options.onCancel?.()))
      return { destroy: vi.fn(), update: vi.fn() } as ReturnType<typeof Modal.confirm>
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('密钥已信任：只连一次，不弹框', async () => {
    mockInvoke.mockResolvedValueOnce(true)
    await connectSsh('conn-1', params)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('connect_ssh', { id: 'conn-1', connection: params })
    expect(Modal.confirm).not.toHaveBeenCalled()
  })

  it('首次见到：弹框展示指纹，用户信任后记下信任并重连', async () => {
    answer = 'ok'
    mockInvoke
      .mockRejectedValueOnce(toError(unknownChallenge))
      .mockResolvedValueOnce(true) // trust_host_key
      .mockResolvedValueOnce(true) // 重连
    await connectSsh('conn-1', params)

    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].title).toBe('确认主机密钥')
    expect(dialogs[0].okButtonProps?.danger).toBeUndefined()
    render(dialogs[0].content as React.ReactElement)
    expect(screen.getByText(/web1\.example\.com:22/)).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 SHA256:new-key')).toBeInTheDocument()

    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['connect_ssh', 'trust_host_key', 'connect_ssh'])
    expect(mockInvoke).toHaveBeenCalledWith('trust_host_key', {
      host: 'web1.example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      key: 'AAAANEW',
    })
  })

  it('用户取消：抛 HostKeyDeclinedError，不记信任、不重连', async () => {
    mockInvoke.mockRejectedValueOnce(toError(unknownChallenge))
    await expect(connectSsh('conn-1', params)).rejects.toBeInstanceOf(HostKeyDeclinedError)
    expect(dialogs).toHaveLength(1)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('密钥变化：红色警告，新旧指纹都展示', async () => {
    answer = 'ok'
    mockInvoke
      .mockRejectedValueOnce(toError(changedChallenge))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    await connectSsh('conn-1', { ...params, port: 2222 })

    expect(dialogs[0].title).toContain('主机密钥已变化')
    expect(dialogs[0].okButtonProps?.danger).toBe(true)
    render(dialogs[0].content as React.ReactElement)
    expect(screen.getByText('ssh-ed25519 SHA256:old-key')).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 SHA256:new-key')).toBeInTheDocument()
    expect(screen.getByText(/web1\.example\.com:2222/)).toBeInTheDocument()
  })

  it('普通连接失败原样抛出，不弹框', async () => {
    mockInvoke.mockRejectedValueOnce('认证失败')
    await expect(connectSsh('conn-1', params)).rejects.toBe('认证失败')
    expect(Modal.confirm).not.toHaveBeenCalled()
  })

  it('同时触发多个确认时排队，一次只弹一个', async () => {
    const first = confirmHostKey(unknownChallenge)
    const second = confirmHostKey(changedChallenge)
    await Promise.resolve()
    expect(dialogs).toHaveLength(1)

    dialogs[0].onOk?.()
    await first
    await Promise.resolve()
    await Promise.resolve()
    expect(dialogs).toHaveLength(2)

    dialogs[1].onCancel?.()
    await expect(second).resolves.toBe(false)
  })
})

describe('testConnection / connectAndCreateTerminal', () => {
  let dialogs: ModalFuncProps[]

  beforeEach(() => {
    dialogs = []
    vi.spyOn(Modal, 'confirm').mockImplementation(options => {
      dialogs.push(options)
      queueMicrotask(() => options.onOk?.())
      return { destroy: vi.fn(), update: vi.fn() } as ReturnType<typeof Modal.confirm>
    })
    useTerminalStore.setState({ connectedConnections: [], activeConnectionId: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('测试连接遇到新主机：确认后重测，返回 true', async () => {
    mockInvoke
      .mockRejectedValueOnce(toError(unknownChallenge))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const result = await testConnection({ host: 'web1.example.com', port: 22, username: 'root', password: 'pw' })
    expect(result).toBe(true)
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['test_connection', 'trust_host_key', 'test_connection'])
    expect(mockInvoke).toHaveBeenLastCalledWith('test_connection', {
      connection: {
        host: 'web1.example.com',
        port: 22,
        username: 'root',
        password: 'pw',
        key_file: null,
        key_passphrase: null,
        auth_method: null,
        jump_host_id: null,
      },
    })
  })

  it('toSSHConnection 把空值规范成 null', () => {
    expect(toSSHConnection({ host: 'h', port: 22, username: 'u', password: '', keyFile: undefined })).toEqual({
      host: 'h',
      port: 22,
      username: 'u',
      password: null,
      key_file: null,
      key_passphrase: null,
      auth_method: null,
      jump_host_id: null,
    })
  })

  it('toSSHConnection 带上私钥口令、认证方式和跳板机', () => {
    expect(
      toSSHConnection({
        host: '10.0.0.5',
        port: 22,
        username: 'ops',
        keyFile: '~/.ssh/id_ed25519',
        keyPassphrase: 'pp',
        authMethod: 'publickey',
        jumpHostId: 'bastion-1',
      }),
    ).toMatchObject({ key_file: '~/.ssh/id_ed25519', key_passphrase: 'pp', auth_method: 'publickey', jump_host_id: 'bastion-1' })

    // ssh-agent 认证：不带密码也不带私钥
    expect(toSSHConnection({ host: 'h', port: 22, username: 'u', authMethod: 'agent' })).toMatchObject({
      password: null,
      key_file: null,
      auth_method: 'agent',
    })
  })

  it('connectAndCreateTerminal：连接、开 shell、加入 store', async () => {
    mockInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce('shell-1')
    const conn = {
      id: 'conn-1', name: 'web', host: 'web1.example.com', port: 22, username: 'root', password: 'pw',
      group: '默认', tags: [], status: 'offline' as const,
    }
    const shellId = await connectAndCreateTerminal(conn as never)
    expect(shellId).toBe('shell-1')
    const state = useTerminalStore.getState()
    expect(state.connectedConnections.map(c => c.connectionId)).toEqual(['conn-1'])
    expect(state.connectedConnections[0].rootPane.sessions.map(s => s.shellId)).toEqual(['shell-1'])
    expect(state.activeConnectionId).toBe('conn-1')
  })
})
