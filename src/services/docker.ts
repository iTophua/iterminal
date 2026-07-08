import { invoke } from '@tauri-apps/api/core'

export interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  /** running / exited / paused / ... */
  state: string
  /** 端口映射，可能为空 */
  ports: string | null
  createdAt: string | null
  // 资源占用（仅运行中容器有值）
  cpuPercent: string | null
  memUsage: string | null
  memPercent: string | null
  netIo: string | null
  blockIo: string | null
}

export interface ImageInfo {
  id: string
  repository: string
  tag: string
  size: string
  createdAt: string | null
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'kill' | 'remove'

/**
 * Docker 管理服务（复用 SSH 会话执行 docker 命令）。
 * 免费版功能。前提：远程服务器已装 docker 且当前用户有权限。
 */

/** 列出容器 */
export async function listContainers(connectionId: string, all = false): Promise<ContainerInfo[]> {
  return invoke<ContainerInfo[]>('list_containers', { connectionId, all })
}

/** 容器操作 */
export async function containerAction(
  connectionId: string,
  containerId: string,
  action: ContainerAction
): Promise<boolean> {
  return invoke<boolean>('container_action', { connectionId, containerId, action })
}

/** 容器日志（一次性，非流式） */
export async function containerLogs(
  connectionId: string,
  containerId: string,
  tail = 500
): Promise<string> {
  return invoke<string>('container_logs', { connectionId, containerId, tail })
}

/** 列出镜像 */
export async function listImages(connectionId: string): Promise<ImageInfo[]> {
  return invoke<ImageInfo[]>('list_images', { connectionId })
}

/** 删除镜像 */
export async function removeImage(connectionId: string, imageId: string): Promise<boolean> {
  return invoke<boolean>('remove_image', { connectionId, imageId })
}

/** 打开容器交互终端（docker exec -it），返回 shellId */
export async function getDockerShell(connectionId: string, containerId: string): Promise<string> {
  return invoke<string>('get_docker_shell', { connectionId, containerId })
}
