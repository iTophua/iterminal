# Stores - Zustand State Management

**Files:** terminalStore.ts (370 lines)

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new state slice | terminalStore.ts | Add to TerminalState interface + implementation |
| Connection management | terminalStore.ts:127-154 | addConnection, closeConnection |
| Session management | terminalStore.ts:156-232 | addSession, closeSession |
| Transfer tasks | terminalStore.ts:309-351 | File upload/download tracking |
| File manager state | terminalStore.ts:291-369 | Path, expanded keys, visibility |

## Data Structures

```
connectedConnections: ConnectedConnection[]
├── connectionId: string
├── connection: Connection
├── sessions: Session[]
│   ├── id, connectionId, shellId, title
└── activeSessionId: string | null

transferTasks: { [connectionId]: TransferTask[] }
├── id, type (upload/download), localPath, remotePath
├── status: pending | transferring | completed | failed | cancelled
└── fileSize, transferred, startTime, endTime

currentPaths: { [connectionId]: string }  // Current directory per connection
expandedKeys: { [connectionId]: string[] }  // File tree expansion state
```

## CONVENTIONS

- **State shape:** All connection-specific state keyed by connectionId
- **ID generation:** Date.now().toString() + random suffix for tasks
- **Cleanup:** closeConnection/closeSession must delete all related state keys
- **Default path:** `/home/{username}` for new connections
- **Session naming:** Auto-increment (会话1, 会话2, ...)

## ANTI-PATTERNS

- **Don't** mutate state directly - always use set()
- **Don't** forget to clean up transferTasks when closing connection
- **Don't** store sensitive data (passwords) in store - Connection interface has password field but should be removed
- **Don't** use array index as session ID - use timestamp

## Notes

- File manager and transfer features are built but SFTP backend is placeholder
- Store persists only in memory - no localStorage sync (connections stored separately in Connections.tsx)