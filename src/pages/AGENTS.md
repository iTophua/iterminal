# Pages

**Pages:** Terminal.tsx (~1700 lines), Connections.tsx (~832 lines), Transfers.tsx

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Events listener | Terminal.tsx | `listen("shell-output-{shellId}")` |
| Shell input handling | Terminal.tsx | `write_shell` on `onData` |
| Terminal cleanup | Terminal.tsx | disposes instance, calls `unlisten()` |
| SplitPane rendering | Terminal.tsx | `renderSplitPane()` 递归渲染分屏 |
| SplitPane helpers | Terminal.tsx | `getAllSessions`, `findPaneBySessionId`, `hasSplitChildren`, `getActiveSessionInPane` |
| Session tabs per pane | Terminal.tsx | `renderSplitPane` 内的 Tabs 组件 |
| Pane toolbar | PaneToolbar.tsx | 每个 pane 独立的工具条（清屏、导出、搜索、分屏） |
| Context menu split | Terminal.tsx | `handleSplitHorizontalFromContextMenu`, `handleVerticalFromContextMenu` |
| Drag session to split | Terminal.tsx | `DraggableSessionTab`, `handlePointerUp`, `moveSessionToSplitPane` |
| Close session logic | Terminal.tsx | `handleCloseSession` - 自动判断是否关闭 pane |
| Fullscreen button | Terminal.tsx | 连接 tab 右侧的全屏按钮 |
| Connection CRUD | Connections.tsx | 使用 database service |
| 数据库服务 | Connections.tsx | import from `../services/database` |
| Group filtering | Connections.tsx | URL 查询参数 `?group=xxx` |
| Connection status UI | Connections.tsx | online/connecting/offline colors |

## SplitPane 分屏架构

Terminal.tsx 使用递归组件 `renderSplitPane` 渲染分屏：

```typescript
// 辅助函数
function getAllSessions(pane: SplitPane): Session[]
function getActiveSessionInPane(pane: SplitPane): Session | null  // 使用 activePaneId 找到正确的 pane
function findPaneBySessionId(pane: SplitPane, sessionId: string): SplitPane | null
function hasSplitChildren(pane: SplitPane | null): boolean
function getVisibleSessions(pane: SplitPane): Session[]
function getPaneStructureKey(pane: SplitPane): string

// 渲染函数
function renderSplitPane(pane: SplitPane, connectionId: string) {
  if (pane.children) {
    return (
      <Group key={getPaneStructureKey(pane)} orientation={...}>
        {pane.children.map(child => (
          <Panel key={child.id} defaultSize={...}>
            {renderSplitPane(child, connectionId)}
          </Panel>
        ))}
      </Group>
    )
  }
  // 每个 pane 有自己的 Tabs 和 PaneToolbar
  return (
    <>
      <PaneToolbar ... />  {/* 每个 pane 独立的工具条 */}
      <Tabs items={sessionTabItems} ... />
    </>
  )
}
```

## 会话标签架构

**每个分屏 pane 有独立的 Tabs 和工具条：**

```
连接 Tab（顶层，包含全屏按钮）
└── 分屏区域
    ├── 左 pane
    │   ├── PaneToolbar (清屏/导出/搜索/分屏/关闭分屏)
    │   └── Tabs: [会话1, 会话2, +新建]
    │       └── 终端内容
    └── 右 pane
        ├── PaneToolbar
        └── Tabs: [会话3, +新建]
                └── 终端内容
```

- 每个 pane 的 Tabs 只显示该 pane 的 sessions
- 每个 pane 有独立的 PaneToolbar，操作只影响当前 pane
- 搜索框在当前活动 pane 内显示
- 点击"新建"在当前 pane 中创建新会话
- 切换 tab 只影响当前 pane 的 `activeSessionId`

## 活动分屏跟踪

**activePaneId 机制**：
- `SplitPane.activePaneId` 记录当前活动的子 pane
- 点击终端时更新 `activePaneId`
- 快捷键操作使用 `getActiveSessionInPane()` 找到正确的 pane

```typescript
// 点击终端时更新
onClick={() => setActiveSessionInPane(connectionId, pane.id, s.id)}

// 快捷键使用
const activeSess = getActiveSessionInPane(activeConn.rootPane)
const pane = findPaneBySessionId(activeConn.rootPane, activeSess?.id || '')
```

## 分屏操作流程

1. **创建分屏**: 调用 `splitPane(connId, paneId, direction, newPaneId, shellId)`
2. **关闭分屏**: 调用 `closePane(connId, paneId)` - 自动合并剩余分屏
3. **关闭会话**: 
   - 如果 pane 只有一个 session 且存在分屏 → 关闭整个 pane
   - 否则只关闭 session
4. **工具栏按钮**: PaneToolbar 在每个 pane 内独立渲染

## 拖拽会话分屏

**触发方式**: 长按会话 tab 500ms 后拖动到 pane 边缘

**实现机制**:
- `DraggableSessionTab` 组件处理长按检测
- `dragTimerRef` 用于 500ms 延迟判断
- `handlePointerMove` 检测拖拽位置和分屏方向
- `handlePointerUp` 执行分屏操作

**分屏行为**:
- 拖动会话到 **同一 pane** 边缘 → 移动会话到新分屏
- 拖动会话到 **其他 pane** 边缘 → 移动会话到目标 pane 的新分屏
- 只有一个会话时拖动 → 创建新会话分屏

**关键状态**:
```typescript
draggedSession: { sessionId, connectionId, title } | null
dropTarget: { paneId, connectionId, direction } | null
dragPosition: { x, y } | null
dragTimerRef: setTimeout 返回值
```

**边缘检测**: 边缘区域为 pane 宽高较小值的 35%

## 终端初始化

使用 `getVisibleSessions()` 获取所有需要初始化的 sessions：

```typescript
const visibleSessions = activeConnection ? getVisibleSessions(activeConnection.rootPane) : []

useEffect(() => {
  for (const session of visibleSessions) {
    if (!initializedRef.current.has(key)) {
      initTerminal(session)
    }
  }
}, [visibleSessions, ...])
```

## 搜索状态管理

搜索状态在 Terminal.tsx 中统一管理，只在当前活动的 pane 显示搜索框：

```typescript
// 全局状态
const [searchVisible, setSearchVisible] = useState(false)
const [searchText, setSearchText] = useState('')

// 切换连接时重置
useEffect(() => {
  setSearchVisible(false)
  setSearchText('')
}, [activeConnectionId])

// 传递给 PaneToolbar
<PaneToolbar
  searchVisible={searchVisible && activeSession?.id === activeSess.id}
  searchText={searchText}
  onToggleSearch={...}
  onSearchTextChange={setSearchText}
/>
```

## CONVENTIONS

- **xterm init:** Create XTerm instance → load FitAddon → `terminal.open(container)` → `fitAddon.fit()` in setTimeout
- **Events:** `listen("shell-output-{shellId}")` receives data from backend, no polling needed
- **数据存储:** 通过 `database.ts` service 调用后端 SQLite，密码加密存储
- **Navigation:** Pass connection via `navigate('/terminal', { state: { connectionId, connection } })`
- **Cleanup:** Call `unlisten()` to cancel event subscription, dispose terminal
- **SplitPane:** 使用 `react-resizable-panels` 库，Group 组件 + Panel 组件
- **Session access:** 通过辅助函数访问会话，不直接访问 `conn.rootPane.sessions`
- **Session naming:** 使用 `getNextSessionNumber()` 获取唯一编号，避免重复
- **分屏 key:** 使用 `getPaneStructureKey()` 生成分屏结构 key，结构变化时强制重新渲染
- **Drag timer:** 组件卸载时必须清理 `dragTimerRef`，防止 `userSelect='none'` 残留
- **PaneToolbar:** 每个 pane 独立渲染，操作只影响当前 pane
- **Fullscreen:** 全屏按钮在连接 tab 右侧，不在工具条中

## 新窗口模式 (singleConnectionMode)

Terminal 组件支持 `singleConnectionMode` prop，用于新窗口场景：

```typescript
<Terminal singleConnectionMode />
```

**行为差异**：

| 功能 | 主窗口 | 新窗口 (singleConnectionMode) |
|------|--------|------------------------------|
| 连接 tab 栏 | 显示 | 隐藏 |
| 全屏按钮 | tab 栏右侧 | 右侧工具栏顶部 |
| 空状态 | 显示最近连接列表 | 不显示，直接关闭窗口 |
| 关闭最后会话 | 清空终端 | 自动关闭窗口 |

**窗口关闭逻辑**：
```typescript
useEffect(() => {
  if (singleConnectionMode && connectedConnections.length === 0) {
    getCurrentWindow().close()
  }
}, [singleConnectionMode, connectedConnections.length])
```

## ANTI-PATTERNS

- **Don't** forget to call `unlisten()` when closing terminal - memory leak
- **Don't** call `fitAddon.fit()` synchronously after open - use setTimeout 100ms
- **Don't** store passwords in localStorage - 已迁移到后端加密存储
- **Don't** mix sync and async terminal writes - always use xterm's async write
- **Don't** access `terminalInstances.current` without null check
- **Don't** 直接访问 `conn.sessions` - 已迁移到 `conn.rootPane`
- **Don't** 使用旧的 `splitSession`/`closeSplitPanel` - 已替换为 `splitPane`/`closePane`
- **Don't** 在关闭最后一个 session 后不关闭 pane - 会导致空白区域
- **Don't** 在顶层渲染 session tabs - 每个 pane 有自己的 tabs
- **Don't** 在 Tabs onChange 中处理 `__add__` key - 会导致 activeSessionId 错误
- **Don't** 忘记清理 dragTimerRef - 组件卸载时必须清理
- **Don't** 使用全局工具条 - 每个 pane 有独立的 PaneToolbar
- **Don't** 快捷键切换会话时使用 getAllSessions - 应在当前 pane 内切换