# Pages

**Pages:** Terminal.tsx (371 lines), Connections.tsx (286 lines), FileManager.tsx (120 lines, placeholder)

## WHERE TO LOOK

| Task | File | Line |
|------|------|------|
| Events listener | Terminal.tsx | listen("shell-output-{shellId}") |
| Shell input handling | Terminal.tsx | `write_shell` on `onData` |
| Terminal cleanup | Terminal.tsx | disposes instance, calls `unlisten()` |
| Connection CRUD | Connections.tsx | 28-103 |
| localStorage persist | Connections.tsx | 51-53 (STORAGE_KEY = 'iterminal_connections') |
| Group filtering | Connections.tsx | 56-63 (filters by selectedGroup) |
| Connection status UI | Connections.tsx | 145-151 (online/connecting/offline colors) |

## CONVENTIONS

- **xterm init:** Create XTerm instance → load FitAddon → `terminal.open(container)` → `fitAddon.fit()` in setTimeout
- **Events:** `listen("shell-output-{shellId}")` receives data from backend, no polling needed
- **localStorage:** Lazy init from localStorage in useState, sync to localStorage in useEffect
- **Navigation:** Pass connection via `navigate('/terminal', { state: { connectionId, connection } })`
- **Cleanup:** Call `unlisten()` to cancel event subscription, dispose terminal

## ANTI-PATTERNS

- **Don't** forget to call `unlisten()` when closing terminal - memory leak
- **Don't** call `fitAddon.fit()` synchronously after open - use setTimeout 100ms
- **Don't** store passwords in plaintext (currently does) - TODO: encrypted storage
- **Don't** mix sync and async terminal writes - always use xterm's async write
- **Don't** access `terminalInstances.current` without null check