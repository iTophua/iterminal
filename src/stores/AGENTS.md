# Stores - Zustand State Management

**Files:** terminalStore.ts (370 lines), transferStore.ts (~100 lines), licenseStore.ts (~80 lines), themeStore.ts (~50 lines)

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new state slice | terminalStore.ts | Add to TerminalState interface + implementation |
| Connection management | terminalStore.ts:127-154 | addConnection, closeConnection |
| Session management | terminalStore.ts:156-232 | addSession, closeSession |
| Transfer tasks | terminalStore.ts:309-351 | File upload/download tracking |
| File manager state | terminalStore.ts:291-369 | Path, expanded keys, visibility |
| License validation | licenseStore.ts | verifyLicense, isFeatureAvailable, getMaxConnections |
| Theme mode | themeStore.ts | appThemeMode, terminalTheme |

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

licenseInfo: LicenseInfo | null (licenseStore.ts)
├── license_type: 'Free' | 'Personal' | 'Professional' | 'Enterprise'
├── expires_at: string | null
├── features: string[]
├── max_connections: number (3 for Free, 999 for paid)
└── is_valid: boolean
```

## CONVENTIONS

- **State shape:** All connection-specific state keyed by connectionId
- **ID generation:** Date.now().toString() + random suffix for tasks
- **Cleanup:** closeConnection/closeSession must delete all related state keys
- **Default path:** `/home/{username}` for new connections
- **Session naming:** Auto-increment (会话1, 会话2, ...)
- **License default:** Free tier, 3 connections max

## ANTI-PATTERNS

- **Don't** mutate state directly - always use set()
- **Don't** forget to clean up transferTasks when closing connection
- **Don't** store sensitive data (passwords) in store - Connection interface has password field but should be removed
- **Don't** use array index as session ID - use timestamp
- **Don't** bypass License check for connection limit