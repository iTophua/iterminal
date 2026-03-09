# Pages

**Pages:** Terminal.tsx (371 lines), Connections.tsx (286 lines), FileManager.tsx (120 lines, placeholder)

## WHERE TO LOOK

| Task | File | Line |
|------|------|------|
| xterm polling loop | Terminal.tsx | 148-188 (500ms interval via `read_shell`) |
| Shell input handling | Terminal.tsx | 123-125 (`write_shell` on `onData`) |
| Terminal cleanup | Terminal.tsx | 197-209 (disposes instance, stops reading) |
| Connection CRUD | Connections.tsx | 28-103 |
| localStorage persist | Connections.tsx | 51-53 (STORAGE_KEY = 'iterminal_connections') |
| Group filtering | Connections.tsx | 56-63 (filters by selectedGroup) |
| Connection status UI | Connections.tsx | 145-151 (online/connecting/offline colors) |

## CONVENTIONS

- **xterm init:** Create XTerm instance → load FitAddon → `terminal.open(container)` → `fitAddon.fit()` in setTimeout
- **Polling loop:** `read_shell` every 500ms via recursive setTimeout, check `readingRef` flag before each call
- **localStorage:** Lazy init from localStorage in useState, sync to localStorage in useEffect
- **Navigation:** Pass connection via `navigate('/terminal', { state: { connectionId, connection } })`
- **Cleanup:** Set reading flag false, dispose terminal, clear intervals in useEffect cleanup

## ANTI-PATTERNS

- **Don't** forget to check `readingRef.current[tabId]` before invoking `read_shell` - causes zombie polls
- **Don't** call `fitAddon.fit()` synchronously after open - use setTimeout 100ms
- **Don't** store passwords in plaintext (currently does) - TODO: encrypted storage
- **Don't** mix sync and async terminal writes - always use xterm's async write
- **Don't** access `terminalInstances.current` without null check in read loop
