import { Modal, Typography, type ModalFuncProps } from 'antd'
import { invoke } from '@tauri-apps/api/core'

/**
 * 主机密钥确认。
 *
 * 后端建连时校验服务器密钥；没信任过、或与之前信任的不一致时，连接以「挑战」失败
 * （错误串带 HOST_KEY_CHALLENGE: 前缀，见 src-tauri 的 host_key.rs）。
 * 这里弹框让用户核对指纹，确认后记下信任，再由调用方重连。
 */

const CHALLENGE_PREFIX = 'HOST_KEY_CHALLENGE:'

/** 一把主机公钥 */
export interface HostKeyInfo {
  /** 密钥类型，如 ssh-ed25519 */
  key_type: string
  /** 公钥内容（base64），信任时原样回传 */
  key: string
  /** SHA256 指纹，与 ssh-keygen -lf 的输出一致 */
  fingerprint: string
}

/** 需要用户确认的主机密钥 */
export interface HostKeyChallenge {
  /** unknown：这台主机第一次见到；changed：与之前信任的不一致 */
  kind: 'unknown' | 'changed'
  host: string
  port: number
  /** 服务器现在给出的公钥 */
  presented: HostKeyInfo
  /** changed 时之前信任的那把 */
  trusted?: HostKeyInfo
}

/** 已信任的主机密钥（设置 → 安全 里展示） */
export interface KnownHost {
  host: string
  port: number
  key_type: string
  key: string
  fingerprint: string
  first_seen_at: string | null
}

/** 用户在确认框里点了取消 */
export class HostKeyDeclinedError extends Error {
  constructor() {
    super('已取消连接：未信任该主机的密钥')
    this.name = 'HostKeyDeclinedError'
  }
}

/** 从 invoke 抛出的错误里取主机密钥挑战；不是挑战返回 null */
export function parseHostKeyChallenge(error: unknown): HostKeyChallenge | null {
  if (typeof error !== 'string' || !error.startsWith(CHALLENGE_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(error.slice(CHALLENGE_PREFIX.length))
    if (!parsed || typeof parsed !== 'object') return null
    const challenge = parsed as Partial<HostKeyChallenge>
    if ((challenge.kind !== 'unknown' && challenge.kind !== 'changed') || !challenge.presented) return null
    return challenge as HostKeyChallenge
  } catch {
    return null
  }
}

/** 服务器上对应的公钥文件，提示用户去核对 */
export function hostKeyFileHint(keyType: string): string {
  const family = /rsa/.test(keyType) ? 'rsa' : /ecdsa/.test(keyType) ? 'ecdsa' : keyType.replace(/^ssh-/, '')
  return `ssh-keygen -lf /etc/ssh/ssh_host_${family}_key.pub`
}

function Fingerprint({ info }: { info: HostKeyInfo | undefined }) {
  const text = `${info?.key_type ?? ''} ${info?.fingerprint ?? ''}`.trim()
  return (
    <Typography.Text code copyable={{ text }}>
      {text}
    </Typography.Text>
  )
}

function confirmOptions(challenge: HostKeyChallenge): ModalFuncProps {
  const target = `${challenge.host}:${challenge.port}`
  if (challenge.kind === 'changed') {
    return {
      title: '警告：主机密钥已变化',
      okText: '我已核实，信任新密钥',
      okButtonProps: { danger: true },
      width: 560,
      content: (
        <div>
          <Typography.Paragraph>
            <Typography.Text strong type="danger">{target}</Typography.Text> 的主机密钥与之前信任的不一致。
          </Typography.Paragraph>
          <Typography.Paragraph>
            这可能是服务器重装或更换了密钥，也可能是连接正被劫持（中间人攻击）。
            除非你确知这台服务器最近有过变更，否则请先向管理员核实再继续。
          </Typography.Paragraph>
          <Typography.Paragraph>
            之前信任：
            <br />
            <Fingerprint info={challenge.trusted} />
          </Typography.Paragraph>
          <Typography.Paragraph>
            现在收到：
            <br />
            <Fingerprint info={challenge.presented} />
          </Typography.Paragraph>
        </div>
      ),
    }
  }
  return {
    title: '确认主机密钥',
    okText: '信任并连接',
    width: 560,
    content: (
      <div>
        <Typography.Paragraph>
          首次连接到 <Typography.Text strong>{target}</Typography.Text>，无法确认它的真实性。
          服务器给出的公钥：
        </Typography.Paragraph>
        <Fingerprint info={challenge.presented} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          请向服务器管理员核对指纹（在服务器上执行{' '}
          <Typography.Text code>{hostKeyFileHint(challenge.presented.key_type)}</Typography.Text>）。
          信任后以后不再询问；密钥变化时会再次警告。
        </Typography.Paragraph>
      </div>
    ),
  }
}

function ask(challenge: HostKeyChallenge): Promise<boolean> {
  return new Promise(resolve => {
    Modal.confirm({
      ...confirmOptions(challenge),
      cancelText: '取消',
      onCancel: () => resolve(false),
      onOk: () => resolve(true),
    })
  })
}

// 同时发起多个连接时会一起触发确认，排队一次只弹一个
let confirmQueue: Promise<unknown> = Promise.resolve()

/** 弹确认框，等用户决定是否信任这把主机密钥 */
export function confirmHostKey(challenge: HostKeyChallenge): Promise<boolean> {
  const run = confirmQueue.then(() => ask(challenge))
  confirmQueue = run.catch(() => {})
  return run
}

/** 记下对 challenge 里那把公钥的信任 */
export async function trustHostKey(challenge: HostKeyChallenge): Promise<void> {
  const { key_type: keyType, key } = challenge.presented
  await invoke('trust_host_key', { host: challenge.host, port: challenge.port, keyType, key })
}

export function getKnownHosts(): Promise<KnownHost[]> {
  return invoke<KnownHost[]>('get_known_hosts')
}

/** 忘记一台主机的密钥；不给 keyType 就忘掉它的全部类型 */
export function forgetHostKey(host: string, port: number, keyType?: string): Promise<boolean> {
  return invoke<boolean>('forget_host_key', { host, port, keyType })
}
