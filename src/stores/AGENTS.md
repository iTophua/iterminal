# Stores - Zustand State Management

**Files:** terminalStore.ts (~1080 lines), transferStore.ts (~100 lines), licenseStore.ts (~80 lines), themeStore.ts (~50 lines)

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new state slice | terminalStore.ts | Add to TerminalState interface + implementation |
| Connection management | terminalStore.ts:263-318 | addConnection, closeConnection |
| Session management | terminalStore.ts:320-350 | addSession, closeSession |
| Split pane operations | terminalStore.ts:490-750 | splitPane, splitPaneWithPosition, moveSessionToSplitPane, closePane |
| Transfer tasks | terminalStore.ts:850-920 | File upload/download tracking |
| File manager state | terminalStore.ts:820-850 | Path, expanded keys, visibility |
| License validation | licenseStore.ts | verifyLicense, isFeatureAvailable, getMaxConnections |
| Theme mode | themeStore.ts | appThemeMode, terminalTheme |

## Data Structures

```
connectedConnections: ConnectedConnection[]
├── connectionId: string
├── connection: Connection
└── rootPane: SplitPane
    ├── id: string
    ├── sessions: Session[]
    │   ├── id, connectionId, shellId, title
    ├── activeSessionId: string | null
    ├── splitDirection?: 'horizontal' | 'vertical'
    ├── children?: SplitPane[]      // 嵌套分屏
    └── sizes?: number[]            // 分屏尺寸比例

disconnectedConnections: DisconnectedConnection[]
├── connectionId: string
├── connection: Connection
├── rootPane: SplitPane             // 保留断开时的会话结构
├── disconnectedAt: number
└── reason: 'write_failed' | 'channel_closed' | 'server_close' | 'unknown'

transferTasks: { [connectionId]: TransferTask[] }
├── id, type (upload/download), localPath, remotePath
├── status: pending | transferring | completed | failed | cancelled
└── fileSize, transferred, startTime, endTime

currentPaths: { [connectionId]: string }  // Current directory per connection
expandedKeys: { [connectionId]: string[] }  // File tree expansion state

licenseInfo: LicenseInfo | null (licenseStore.ts)
├── license_type: 'Free' | 'Personal' | 'Professional' | 'Enterprise'
├── expires_at: string | null
├── features: string[]
├── max_connections: number (3 for Free, 999 for paid)
└── is_valid: boolean
```

## SplitPane 分屏模型

SplitPane 支持递归嵌套，每个 pane 可以：
- 包含多个 sessions（同一 pane 内的会话共享标签栏）
- 包含子 panes（实现嵌套分屏）

```
rootPane (无分屏时)
└── sessions: [session1]

rootPane (水平分屏后)
├── splitDirection: 'horizontal'
├── children: [
│     { id: 'pane-1', sessions: [session1] },
│     { id: 'pane-2', sessions: [session2] }
│   ]
└── sizes: [50, 50]
```

## SplitPane 相关方法

| Method | Description |
|--------|-------------|
| `splitPane(connId, paneId, direction, newPaneId, shellId)` | 将指定 pane 分屏，创建新 pane |
| `splitPaneWithPosition(connId, paneId, direction, newPaneId, shellId, position)` | 带位置的分屏，position 为 'first' 或 'second' |
| `moveSessionToSplitPane(connId, sourcePaneId, sessionId, targetPaneId, direction, position)` | 移动现有会话到新分屏（拖拽会话时使用） |
| `closePane(connId, paneId)` | 关闭指定 pane 及其所有会话，自动合并剩余分屏 |
| `addSessionToPane(connId, paneId, shellId)` | 在指定 pane 中添加会话 |
| `closeSessionInPane(connId, paneId, sessionId)` | 关闭指定 pane 中的会话 |
| `setActiveSessionInPane(connId, paneId, sessionId)` | 设置 pane 的活动会话 |
| `findPaneBySession(connId, sessionId)` | 根据会话 ID 查找所在 pane |
| `updatePaneSizes(connId, paneId, sizes)` | 更新分屏尺寸 |

## moveSessionToSplitPane 说明

用于拖拽会话 tab 分屏场景：

**sourcePaneId === targetPaneId** (同一 pane 内拖拽):
- 原子操作：一次性创建分屏结构
- 移动的会话放入新子 pane
- 剩余会话放入另一个子 pane

**sourcePaneId !== targetPaneId** (跨 pane 拖拽):
- 先从源 pane 移除会话
- 再在目标 pane 创建分屏

## closePane 行为说明

关闭 pane 后会自动处理剩余结构：

```typescript
// 关闭前
children: [pane1, pane2]  // 关闭 pane2

// 关闭后（只剩一个 child）
{
  id: 'pane-new',         // 新 id，触发 React 重新挂载
  sessions: [...],        // 继承剩余 pane 的 sessions
  // splitDirection, children, sizes 被清除
}
```

## 辅助函数（Terminal.tsx 中）

```typescript
// 获取 pane 中所有会话（包括嵌套的）
function getAllSessions(pane: SplitPane): Session[]

// 获取 pane 中当前激活的会话
function getActiveSessionInPane(pane: SplitPane): Session | null

// 根据 sessionId 找到所在的 pane
function findPaneBySessionId(pane: SplitPane, sessionId: string): SplitPane | null

// 检查 pane 是否有子分屏
function hasSplitChildren(pane: SplitPane): boolean

// 统计 pane 中的会话数量
function countSessions(pane: SplitPane): number

// 获取所有可见会话（用于初始化终端）
function getVisibleSessions(pane: SplitPane): Session[]

// 生成分屏结构 key（用于 React key）
function getPaneStructureKey(pane: SplitPane): string
```

## 辅助函数（terminalStore.ts 中）

```typescript
// 统计 pane 中的会话数量
function countSessions(pane: SplitPane): number

// 获取下一个会话编号（避免重复）
function getNextSessionNumber(pane: SplitPane): number
  // 遍历所有会话标题，找到最大编号 +1
  // 确保会话名称不重复
```

## 关闭会话逻辑

```typescript
handleCloseSession(connId, sessId, paneId):
  if (只有一个会话):
    关闭整个连接
  else if (pane 存在):
    if (pane 只有一个 session 且存在分屏):
      closePane()  // 关闭整个 pane，合并分屏
    else:
      closeSessionInPane()  // 只关闭 session
  else:
    closeSession()
```

## CONVENTIONS

- **State shape:** All connection-specific state keyed by connectionId
- **ID generation:** 使用 `baseTime + idCounter` 确保唯一性，避免 `Date.now()` 重复
- **Cleanup:** closeConnection/closeSession must delete all related state keys
- **Default path:** `/home/{username}` for new connections
- **Session naming:** 使用 `getNextSessionNumber()` 获取唯一编号，避免名称重复
- **License default:** Free tier, 3 connections max
- **SplitPane ID:** 使用 `baseTime + counter` 生成唯一 ID
- **分屏渲染:** 使用 `react-resizable-panels` 的 Group/Panel 组件

## ANTI-PATTERNS

- **Don't** mutate state directly - always use set()
- **Don't** forget to clean up transferTasks when closing connection
- **Don't** store sensitive data (passwords) in store - 已迁移到后端加密存储
- **Don't** use array index as session ID - use timestamp
- **Don't** bypass License check for connection limit
- **Don't** 直接访问 `conn.sessions` - 使用 `conn.rootPane.sessions` 或辅助函数
- **Don't** 假设 sessions 只在 rootPane - 可能嵌套在 children 中
- **Don't** 在关闭最后一个 session 后不关闭 pane - 会导致空白区域
- **Don't** 使用 `countSessions()` 生成会话名称 - 会产生重复，使用 `getNextSessionNumber()`
- **Don't** 多次调用 `Date.now()` 生成 ID - 可能重复，使用 `baseTime + counter`