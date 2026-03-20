# Stores - Zustand State Management

**Files:** terminalStore.ts (~840 lines), transferStore.ts (~100 lines), licenseStore.ts (~80 lines), themeStore.ts (~50 lines)

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new state slice | terminalStore.ts | Add to TerminalState interface + implementation |
| Connection management | terminalStore.ts:263-293 | addConnection, closeConnection |
| Session management | terminalStore.ts:295-340 | addSession, closeSession |
| Split pane operations | terminalStore.ts:449-520 | splitPane, closePane, addSessionToPane |
| Transfer tasks | terminalStore.ts:668-720 | File upload/download tracking |
| File manager state | terminalStore.ts:640-666 | Path, expanded keys, visibility |
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
│     { sessions: [session1] },
│     { sessions: [session2] }  // 新分出的 pane
│   ]
└── sizes: [50, 50]
```

## SplitPane 相关方法

| Method | Description |
|--------|-------------|
| `splitPane(connId, paneId, direction, newPaneId, shellId)` | 将指定 pane 分屏，创建新 pane |
| `closePane(connId, paneId)` | 关闭指定 pane 及其所有会话 |
| `addSessionToPane(connId, paneId, shellId)` | 在指定 pane 中添加会话 |
| `closeSessionInPane(connId, paneId, sessionId)` | 关闭指定 pane 中的会话 |
| `setActiveSessionInPane(connId, paneId, sessionId)` | 设置 pane 的活动会话 |
| `findPaneBySession(connId, sessionId)` | 根据会话 ID 查找所在 pane |
| `updatePaneSizes(connId, paneId, sizes)` | 更新分屏尺寸 |

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
```

## CONVENTIONS

- **State shape:** All connection-specific state keyed by connectionId
- **ID generation:** Date.now().toString() + random suffix for tasks
- **Cleanup:** closeConnection/closeSession must delete all related state keys
- **Default path:** `/home/{username}` for new connections
- **Session naming:** Auto-increment (会话1, 会话2, ...)
- **License default:** Free tier, 3 connections max
- **SplitPane ID:** 使用时间戳作为 pane ID

## ANTI-PATTERNS

- **Don't** mutate state directly - always use set()
- **Don't** forget to clean up transferTasks when closing connection
- **Don't** store sensitive data (passwords) in store - 已迁移到后端加密存储
- **Don't** use array index as session ID - use timestamp
- **Don't** bypass License check for connection limit
- **Don't** 直接访问 `conn.sessions` - 使用 `conn.rootPane.sessions` 或辅助函数
- **Don't** 假设 sessions 只在 rootPane - 可能嵌套在 children 中