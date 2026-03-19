# Pages

**Pages:** Terminal.tsx (~1010 lines), Connections.tsx (~832 lines), Transfers.tsx

## WHERE TO LOOK

| Task | File | Line |
|------|------|------|
| Events listener | Terminal.tsx | listen("shell-output-{shellId}") |
| Shell input handling | Terminal.tsx | `write_shell` on `onData` |
| Terminal cleanup | Terminal.tsx | disposes instance, calls `unlisten()` |
| Connection CRUD | Connections.tsx | 使用 database service |
| 数据库服务 | Connections.tsx | import from `../services/database` |
| Group filtering | Connections.tsx | URL 查询参数 `?group=xxx` |
| Connection status UI | Connections.tsx | online/connecting/offline colors |

## CONVENTIONS

- **xterm init:** Create XTerm instance → load FitAddon → `terminal.open(container)` → `fitAddon.fit()` in setTimeout
- **Events:** `listen("shell-output-{shellId}")` receives data from backend, no polling needed
- **数据存储:** 通过 `database.ts` service 调用后端 SQLite，密码加密存储
- **Navigation:** Pass connection via `navigate('/terminal', { state: { connectionId, connection } })`
- **Cleanup:** Call `unlisten()` to cancel event subscription, dispose terminal

## ANTI-PATTERNS

- **Don't** forget to call `unlisten()` when closing terminal - memory leak
- **Don't** call `fitAddon.fit()` synchronously after open - use setTimeout 100ms
- **Don't** store passwords in localStorage - 已迁移到后端加密存储
- **Don't** mix sync and async terminal writes - always use xterm's async write
- **Don't** access `terminalInstances.current` without null check