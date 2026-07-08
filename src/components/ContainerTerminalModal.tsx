import { useEffect, useRef, useState } from 'react'
import { Modal, Spin, App } from 'antd'
import { CodeOutlined } from '@ant-design/icons'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import type { ContainerInfo } from '../services/docker'

interface Props {
  connectionId: string | null
  container: ContainerInfo | null
  onClose: () => void
}

/**
 * 容器交互终端 Modal（docker exec -it bash）。
 *
 * 打开时调 getDockerShell 拿 dockerShellId，挂载 xterm：
 * - onData → write_shell
 * - onResize → resize_shell
 * - listen('shell-output-{id}') → term.write
 * 关闭时 unlisten + close_shell + dispose。
 */
export default function ContainerTerminalModal({ connectionId, container, onClose }: Props) {
  const { message } = App.useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const dockerShellIdRef = useRef<string | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [loading, setLoading] = useState(false)

  const visible = !!container

  useEffect(() => {
    if (!visible || !connectionId || !container) return

    let disposed = false
    setLoading(true)

    const init = async () => {
      try {
        // 1. 打开 docker exec shell
        const dockerShellId = await invoke<string>('get_docker_shell', {
          id: connectionId,
          containerId: container.id,
        })
        if (disposed) {
          // 已关闭，立即清理
          invoke('close_shell', { id: dockerShellId }).catch(() => {})
          return
        }
        dockerShellIdRef.current = dockerShellId

        // 2. 等容器有尺寸
        const el = containerRef.current
        if (!el) return
        // 等待 DOM 渲染出非零尺寸
        await new Promise<void>(resolve => {
          if (el.clientWidth > 0 && el.clientHeight > 0) resolve()
          else {
            const raf = requestAnimationFrame(() => resolve())
            setTimeout(() => { cancelAnimationFrame(raf); resolve() }, 100)
          }
        })
        if (disposed) return

        // 3. 创建 xterm
        const term = new XTerm({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: { background: '#1e1e1e' },
          convertEol: true,
        })
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        el.innerHTML = ''
        term.open(el)
        termRef.current = term
        fitRef.current = fitAddon
        try { fitAddon.fit() } catch {}

        // 4. 监听输出
        const eventName = `shell-output-${dockerShellId}`
        const unlisten = await listen<string>(eventName, (event) => {
          if (disposed) return
          const payload = event.payload as any
          if (payload && typeof payload === 'object' && payload.eof) {
            term.write('\r\n\x1b[33m[容器会话已结束]\x1b[0m\r\n')
            return
          }
          if (payload) term.write(payload as string)
        })
        unlistenRef.current = unlisten

        // 5. 输入 → write_shell
        const onDataDisp = term.onData((data) => {
          invoke('write_shell', { id: dockerShellId, data }).catch(() => {})
        })
        // 6. 尺寸变化 → resize_shell
        const onResizeDisp = term.onResize(({ cols, rows }) => {
          invoke('resize_shell', { id: dockerShellId, cols, rows }).catch(() => {})
        })
        // 初始尺寸同步一次
        invoke('resize_shell', { id: dockerShellId, cols: term.cols, rows: term.rows }).catch(() => {})

        // 7. ResizeObserver 自适应
        const ro = new ResizeObserver(() => {
          try { fitAddon.fit() } catch {}
        })
        ro.observe(el)
        observerRef.current = ro

        // 保存 dispose 句柄（组件卸载时用）
        ;(term as any).__disposers = [onDataDisp, onResizeDisp]

        setLoading(false)
        term.focus()
      } catch (err) {
        setLoading(false)
        message.error(`打开容器终端失败: ${err}`)
        onClose()
      }
    }

    init()

    return () => {
      disposed = true
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, connectionId, container])

  const cleanup = () => {
    // dispose xterm
    const term = termRef.current
    if (term) {
      const disps = (term as any).__disposers as Array<{ dispose: () => void }> | undefined
      disps?.forEach(d => { try { d.dispose() } catch {} })
      try { term.dispose() } catch {}
    }
    termRef.current = null
    fitRef.current = null
    // unlisten
    unlistenRef.current?.()
    unlistenRef.current = null
    // observer
    observerRef.current?.disconnect()
    observerRef.current = null
    // 关闭 shell
    const sid = dockerShellIdRef.current
    if (sid) invoke('close_shell', { id: sid }).catch(() => {})
    dockerShellIdRef.current = null
  }

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CodeOutlined style={{ color: 'var(--color-primary)' }} />
          容器终端
          {container && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{container.name}</span>}
        </span>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnClose
      styles={{ body: { padding: 0, background: '#1e1e1e' } }}
    >
      <div style={{ position: 'relative', height: 480 }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: '#1e1e1e',
          }}>
            <Spin tip="正在打开容器终端..." />
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%', padding: 4 }} />
      </div>
    </Modal>
  )
}
