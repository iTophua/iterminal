# FileManager Module

文件管理面板模块，负责 SFTP 文件操作和 UI。

## 结构

```
fileManager/
├── types.ts              # 类型定义
├── utils.ts              # 工具函数
├── Modals.tsx            # Modal 组件
├── ContextMenu.tsx       # 右键菜单
├── FileList.tsx          # 文件列表
├── FileToolbar.tsx       # 工具栏
├── index.ts              # 导出
└── hooks/
    ├── useFileManager.ts     # 核心状态管理
    ├── useFileOperations.ts  # 文件 CRUD 操作
    ├── useTransfer.ts        # 上传下载逻辑
    └── useDragDrop.ts        # 拖拽处理
```

## Hook 职责

### useFileManager
- 目录加载 (`loadDirectory`)
- 树形数据状态 (`treeData`, `treeDataRef`)
- 选择状态 (`selectedKeys`, `selectedNode`)
- 展开/折叠 (`expandedKeys`)
- 刷新 (`refreshCurrent`, `refreshDirectory`)

### useFileOperations
- 文件 CRUD: 创建、重命名、删除、权限修改
- 压缩/解压
- 文件预览/编辑
- 文件搜索
- Modal 状态管理

### useTransfer
- 上传文件/文件夹
- 下载文件
- 冲突处理 (覆盖/跳过/重命名)
- 传输进度事件监听
- TransferStore 更新

### useDragDrop
- 拖拽进入/离开检测
- 拖拽目标高亮
- 文件放置处理

## 组件职责

| 组件 | 职责 |
|------|------|
| FileManagerPanel | 主组件，组合 hooks 和子组件 |
| FileList | 渲染树形/列表视图，处理选择和右键 |
| ContextMenu | 右键菜单 (portal 渲染) |
| Modals | 各种确认对话框 |

## 数据流

```
FileManagerPanel
    │
    ├── useFileManager()
    │       └── treeData, selectedNode, loading
    │
    ├── useFileOperations()
    │       └── modal state, CRUD handlers
    │
    ├── useTransfer()
    │       └── upload/download, conflict resolution
    │
    └── useDragDrop()
            └── drag events, drop target

          │
          ▼

    FileList ───► renders tree/list
    ContextMenu ─► right-click actions
    Modals ──────► confirm dialogs
```

## 事件监听

| 事件 | 用途 |
|------|------|
| `transfer-progress-{taskId}` | 传输进度更新 |
| `transfer-complete-{taskId}` | 传输完成通知 |
| `transfer-paused-{taskId}` | 传输暂停 |
| `transfer-resumed-{taskId}` | 传输恢复 |

## 约定

- 所有 hooks 接收 `connectionId` 作为参数
- 使用 `selectedNodeRef` 保持最新选择状态
- 使用 `treeDataRef` 在回调中访问最新树数据
- Modal 状态由 `useFileOperations` 管理
- 传输状态由 `useTransferStore` 管理

## 注意事项

- 右键菜单使用 `createPortal` 渲染到 `document.body`
- 文件列表支持树形和列表两种视图模式
- 列表视图支持按名称/大小/修改时间排序
- 拖拽上传时高亮目标目录