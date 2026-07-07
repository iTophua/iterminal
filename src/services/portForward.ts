import { invoke } from '@tauri-apps/api/core'

export interface PortForwardInfo {
  id: string
  connection_id: string
  local_port: number
  remote_host: string
  remote_port: number
}

/**
 * 端口转发服务（Pro 功能 port_forward）
 *
 * 后端 start_port_forward 会做 check_feature('port_forward') 校验，
 * Free 构建直接拒绝。
 */
export async function startPortForward(params: {
  connectionId: string
  localPort: number
  remoteHost: string
  remotePort: number
}): Promise<PortForwardInfo> {
  return invoke<PortForwardInfo>('start_port_forward', {
    connectionId: params.connectionId,
    localPort: params.localPort,
    remoteHost: params.remoteHost,
    remotePort: params.remotePort,
  })
}

export async function stopPortForward(forwardId: string): Promise<boolean> {
  return invoke<boolean>('stop_port_forward', { forwardId })
}

export async function listPortForwards(): Promise<PortForwardInfo[]> {
  return invoke<PortForwardInfo[]>('list_port_forwards')
}
