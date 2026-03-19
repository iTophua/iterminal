# Types

TypeScript type definitions for iTerminal.

## Where to Look

| File | Purpose |
|------|---------|
| theme.ts | Theme configuration types (ThemeMode, ThemeConfig) |
| theme.d.ts | Theme type declarations |
| shared.ts | Shared types (Connection, SSHConnection, TerminalSettings) |

## Key Types

```typescript
// Connection (shared.ts)
interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  keyFile?: string       // SSH 密钥文件路径
  group: string
  tags?: string[]
  status: 'online' | 'offline' | 'connecting'
}

// TerminalSettings (shared.ts)
interface TerminalSettings {
  fontFamily: string
  fontSize: number
  scrollback: number
  copyOnSelect: boolean
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
}

// ThemeMode (theme.ts)
type ThemeMode = 'light' | 'dark' | 'system'
```

## Conventions

- Types are defined in shared.ts, theme-specific in theme.ts
- .d.ts files for ambient type declarations
- Avoid inline type definitions - extract to types/

## Anti-Patterns

- Don't duplicate types across files
- Don't use `any` - use `unknown` or specific types