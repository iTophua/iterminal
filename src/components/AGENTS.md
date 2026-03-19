# Components

UI components for iTerminal.

## Where to Look

| Component | Lines | Role |
|-----------|-------|------|
| Sidebar.tsx | 270 | Navigation, group management, connection counts, settings trigger |
| FileManagerPanel.tsx | 750 | SFTP file manager main component (orchestrates hooks and sub-components) |
| MonitorPanel.tsx | 331 | System monitoring, CPU/memory/disk visualization, 3s auto-refresh |
| SettingsPanel.tsx | 680 | Settings modal with appearance, terminal, MCP, License categories |
| ThemeProvider.tsx | 139 | Ant Design ConfigProvider with theme algorithm |
| McpLogPanel.tsx | 269 | MCP operation logs, filter by status, download |

## FileManagerPanel Architecture

```
fileManager/
├── types.ts              # TreeNode, ConflictFile, interface definitions
├── utils.ts              # formatSize, isCompressedFile, path utilities
├── Modals.tsx            # NewFileModal, RenameModal, DeleteModal, etc.
├── ContextMenu.tsx       # Right-click context menu (portal)
├── FileList.tsx          # Tree/List view rendering with sorting
├── FileToolbar.tsx       # Navigation and action buttons
├── index.ts              # Public exports
└── hooks/
    ├── useFileManager.ts     # Core state: treeData, loading, selection
    ├── useFileOperations.ts  # CRUD: create, rename, delete, chmod, compress
    ├── useTransfer.ts        # Upload/download with progress events
    └── useDragDrop.ts        # Drag-drop file upload handling
```

### Hook Responsibilities

| Hook | Purpose |
|------|---------|
| useFileManager | Directory loading, tree state, selection, navigation |
| useFileOperations | File CRUD operations and modal state |
| useTransfer | Upload/download with Tauri events and transfer store |
| useDragDrop | Drag-drop detection, target highlighting, file handling |

### Data Flow

```
FileManagerPanel
    ├── useFileManager()     → treeData, selectedNode, loading
    ├── useFileOperations()  → modal state, CRUD handlers
    ├── useTransfer()        → upload/download, conflict resolution
    └── useDragDrop()        → drag events, drop target
          │
          ▼
    FileList → renders tree/list view
    ContextMenu → right-click actions
    Modals → confirm dialogs
```

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
- Don't put all logic in one component - use hooks for separation