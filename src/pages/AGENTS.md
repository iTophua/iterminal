# Pages

**Pages:** Terminal.tsx (~1330 lines), Connections.tsx (~832 lines), Transfers.tsx

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Events listener | Terminal.tsx | `listen("shell-output-{shellId}")` |
| Shell input handling | Terminal.tsx | `write_shell` on `onData` |
| Terminal cleanup | Terminal.tsx | disposes instance, calls `unlisten()` |
| SplitPane rendering | Terminal.tsx | `renderSplitPane()` 递归渲染分屏 |
| SplitPane helpers | Terminal.tsx | `getAllSessions`, `findPaneBySessionId`, `hasSplitChildren` |
| Context menu split | Terminal.tsx | `handleSplitHorizontalFromContextMenu`, `handleSplitVerticalFromContextMenu` |
| Toolbar split buttons | Terminal.tsx | `onSplitHorizontal`, `onSplitVertical`, `onCloseSplit` |
| Connection CRUD | Connections.tsx | 使用 database service |
| 数据库服务 | Connections.tsx | import from `../services/database` |
| Group filtering | Connections.tsx | URL 查询参数 `?group=xxx` |
| Connection status UI | Connections.tsx | online/connecting/offline colors |

## SplitPane 分屏架构

Terminal.tsx 使用递归组件 `renderSplitPane` 渲染分屏：

```typescript
// 辅助函数
function getAllSessions(pane: SplitPane): Session[]      // 获取所有会话（含嵌套）
function getActiveSessionInPane(pane: SplitPane): Session | null  // 获取活动会话
function findPaneBySessionId(pane: SplitPane, sessionId: string): SplitPane | null  // 查找 pane
function hasSplitChildren(pane: SplitPane): boolean      // 检查是否有分屏

// 渲染函数
function renderSplitPane(pane: SplitPane, connectionId: string): React.ReactNode {
  if (pane.children) {
    // 渲染分屏容器（使用 react-resizable-panels 的 Group）
    return <Group orientation={...}>{pane.children.map(renderSplitPane)}</Group>
  }
  // 渲染单个终端容器
  return <div ref={terminalRef} ... />
}
```

## 分屏操作流程

1. **创建分屏**: 调用 `splitPane(connId, paneId, direction, newPaneId, shellId)`
2. **关闭分屏**: 调用 `closePane(connId, paneId)` - 会关闭该 pane 下所有会话
3. **工具栏按钮**: 检查 `hasSplitChildren(rootPane)` 显示关闭分屏按钮

## CONVENTIONS

- **xterm init:** Create XTerm instance → load FitAddon → `terminal.open(container)` → `fitAddon.fit()` in setTimeout
- **Events:** `listen("shell-output-{shellId}")` receives data from backend, no polling needed
- **数据存储:** 通过 `database.ts` service 调用后端 SQLite，密码加密存储
- **Navigation:** Pass connection via `navigate('/terminal', { state: { connectionId, connection } })`
- **Cleanup:** Call `unlisten()` to cancel event subscription, dispose terminal
- **SplitPane:** 使用 `react-resizable-panels` 库，Group 组件 + Panel 组件
- **Session access:** 通过辅助函数访问会话，不直接访问 `conn.rootPane.sessions`

## ANTI-PATTERNS

- **Don't** forget to call `unlisten()` when closing terminal - memory leak
- **Don't** call `fitAddon.fit()` synchronously after open - use setTimeout 100ms
- **Don't** store passwords in localStorage - 已迁移到后端加密存储
- **Don't** mix sync and async terminal writes - always use xterm's async write
- **Don't** access `terminalInstances.current` without null check
- **Don't** 直接访问 `conn.sessions` - 已迁移到 `conn.rootPane`
- **Don't** 使用旧的 `splitSession`/`closeSplitPanel` - 已替换为 `splitPane`/`closePane`