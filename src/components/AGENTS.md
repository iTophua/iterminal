# Components

UI components for iTerminal.

## Where to Look

| Component | Lines | Role |
|-----------|-------|------|
| Sidebar.tsx | 270 | Navigation, group management, connection counts, settings trigger |
| FileManagerPanel.tsx | 1519 | SFTP file manager, drag-drop upload, context menu, transfer events |
| MonitorPanel.tsx | 331 | System monitoring, CPU/memory/disk visualization, 3s auto-refresh |
| SettingsPanel.tsx | 680 | Settings modal with appearance, terminal, MCP, License categories |
| ThemeProvider.tsx | 139 | Ant Design ConfigProvider with theme algorithm |
| McpLogPanel.tsx | 269 | MCP operation logs, filter by status, download |

## Conventions

- Fixed-position panels: `position: fixed`, `right: 0`, `zIndex: 999+`
- Panel width: 320px (Monitor), 360px (FileManager), 380px (McpLog)
- Colors via CSS vars: `var(--color-primary)`, `var(--color-bg-container)`
- Tauri events: `listen("event-name-{id}", handler)` with cleanup
- localStorage keys: `iterminal_*` prefix
- Icons from `@ant-design/icons`, emojis for section headers
- Settings categories: appearance, terminal, mcp, license, shortcuts, about

## Anti-Patterns

- Don't forget to unlisten Tauri events on unmount
- Don't call `treeDataRef.current = treeData` without useEffect sync
- Don't hardcode theme colors except semantic ones (purple, cyan, pink for operations)
- Don't forget `connectionId` check before invoking Tauri commands
- Don't use `document.body` for portals without cleanup
