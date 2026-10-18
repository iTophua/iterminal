import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'

// jsdom 无 ResizeObserver
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  ;(globalThis as any).ResizeObserver = ResizeObserverStub
}

import { CockpitLayout } from '../CockpitLayout'
import { useTerminalStore, type Connection, type SplitPane } from '../../../../../stores/terminalStore'

function makeConn(id: string, name: string, sessionCount = 1): { connectionId: string; connection: Connection; rootPane: SplitPane } {
  const sessionId = `${id}-s1`
  const rootPane: SplitPane = {
    id: `${id}-p1`,
    sessions: Array.from({ length: sessionCount }, (_, i) => ({
      id: `${id}-s${i + 1}`,
      connectionId: id,
      shellId: `${id}-sh${i + 1}`,
      title: `会话${i + 1}`,
    })),
    activeSessionId: sessionId,
  }
  return {
    connectionId: id,
    connection: {
      id, name, host: `192.168.1.${id.length}`, port: 22, username: 'root',
      group: '生产环境', tags: [], status: 'online',
    },
    rootPane,
  }
}

describe('CockpitLayout', () => {
  const noop = vi.fn()

  // drawer 状态由父级持有，测试里用真实 useState 驱动（与 Terminal 中一致）
  function Harness(props: Record<string, unknown>) {
    const [drawer, setDrawer] = useState<{ open: boolean; tab: 'files' | 'monitor' | 'docker' | 'ports' | 'ai' }>({ open: false, tab: 'monitor' })
    return (
      <MemoryRouter>
        <CockpitLayout
          connectedConnections={props.connectedConnections as any}
          allConnections={props.allConnections as Connection[]}
          currentPaths={{}}
          currentThemeColors={{ foreground: '#fff' } as any}
          fontFamily="Menlo"
          fontSize={12}
          broadcastEnabled={false}
          terminalRefs={{ current: {} }}
          ghostTextElementsRef={{ current: {} }}
          terminalInstances={{ current: {} }}
          searchAddons={{ current: {} }}
          enqueueWrite={noop}
          drawer={drawer}
          onDrawerChange={setDrawer}
          onSessionContextMenu={noop}
          onCloseSession={noop}
          onReconnect={noop}
          onHostClick={noop}
          onNewSession={noop}
          onDetachToNewWindow={noop}
          activeSearchSessionKey={null}
          setActiveSearchSessionKey={noop}
          searchText=""
          setSearchText={noop}
          searchMode="normal"
          setSearchMode={noop}
          drawerPanels={{}}
        />
      </MemoryRouter>
    )
  }

  function setup(connected: ReturnType<typeof makeConn>[] = [], all: Connection[] = []) {
    return render(
      <Harness connectedConnections={connected} allConnections={all} />
    )
  }


  beforeEach(() => {
    useTerminalStore.setState({ cockpitFocusKey: null, cockpitWindowGeometry: {}, cockpitTheme: 'force' })
    window.localStorage.clear()
  })

  it('无连接时渲染主机墙与空状态提示', () => {
    setup([], [{ id: 'a', name: 'Web', host: '1.2.3.4', port: 22, username: 'root', group: '', tags: [], status: 'offline' }])
    expect(screen.getByText('主机')).toBeInTheDocument()
    expect(screen.getByText(/浮动窗口/)).toBeInTheDocument()
  })

  it('每个会话渲染一个浮动窗口，聚焦窗口高亮', () => {
    const conn = makeConn('web', 'Web 服务器', 2)
    setup([conn] as any)
    const wins = document.querySelectorAll('.ck-win')
    expect(wins.length).toBe(2)
    expect(document.querySelectorAll('.ck-win.focus').length).toBe(1)
  })

  it('点击停靠栏缩略卡切换聚焦并同步活动会话', () => {
    const conn = makeConn('web', 'Web 服务器', 2)
    setup([conn] as any)
    const dockCards = document.querySelectorAll('.ck-dk')
    expect(dockCards.length).toBe(2)

    fireEvent.click(dockCards[1])
    const state = useTerminalStore.getState()
    expect(state.cockpitFocusKey).toBe('web_web-s2')
    expect(state.activeConnectionId).toBe('web')
  })

  it('点击右侧工具栏展开抽屉并可切换 tab', () => {
    const conn = makeConn('web', 'Web 服务器')
    setup([conn] as any)
    fireEvent.click(screen.getByTitle('系统监控'))
    expect(document.querySelector('.ck-drawer')).toBeInTheDocument()
    // 切到 Docker tab
    fireEvent.click(screen.getByText('Docker', { selector: '.ck-dr-tabs button' }))
    expect(document.querySelector('.ck-dr-tabs button.on')?.textContent).toContain('Docker')
  })

  it('⌘K 打开命令面板并能搜索主机', () => {
    setup([], [{ id: 'a', name: 'Web 服务器', host: '1.2.3.4', port: 22, username: 'root', group: '', tags: [], status: 'offline' }])
    fireEvent.click(screen.getByText('搜索主机、跳转会话、运行命令…'))
    const input = screen.getByPlaceholderText(/连接主机/) as HTMLInputElement
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Web' } })
    expect(screen.getByText(/连接 Web 服务器/)).toBeInTheDocument()
  })

  it('主机墙可折叠为图标条并持久化状态', () => {
    setup([], [{ id: 'a', name: 'Web 服务器', host: '1.2.3.4', port: 22, username: 'root', group: '', tags: [], status: 'offline' }])
    fireEvent.click(screen.getByTitle('折叠主机墙'))
    const collapsed = document.querySelector('.ck-wall-collapsed')
    expect(collapsed).toBeInTheDocument()
    // 图标条仍有主机入口
    expect(screen.getByTitle(/Web 服务器/)).toBeInTheDocument()
    // 状态已写入 store（持久化由 setter 负责）
    expect(useTerminalStore.getState().cockpitWallCollapsed).toBe(true)
    fireEvent.click(screen.getByTitle('展开主机墙'))
    expect(document.querySelector('.ck-wall-collapsed')).toBeNull()
    expect(useTerminalStore.getState().cockpitWallCollapsed).toBe(false)
  })

  it('专注模式隐藏主机墙与停靠栏', () => {
    const conn = makeConn('web', 'Web 服务器')
    setup([conn] as any)
    expect(document.querySelector('.ck-wall')).toBeInTheDocument()
    expect(document.querySelector('.ck-dock')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle(/专注模式/))
    expect(document.querySelector('.ck-wall')).toBeNull()
    expect(document.querySelector('.ck-dock')).toBeNull()
    // 窗口仍在
    expect(document.querySelectorAll('.ck-win').length).toBe(1)
  })

  it('切换驾驶舱主题即时生效', () => {
    setup([])
    fireEvent.click(screen.getByTitle('驾驶舱主题'))
    fireEvent.click(screen.getByText('余烬'))
    const root = document.querySelector('.ck-root') as HTMLElement
    expect(root.style.getPropertyValue('--ck-accent')).toBe('#FFA94D')
    expect(useTerminalStore.getState().cockpitTheme).toBe('ember')
  })
})
