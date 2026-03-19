# Services

前端服务层，封装后端 Tauri 命令调用。

## 文件

```
services/
└── database.ts    # 数据库服务层
```

## database.ts

封装数据库操作，调用后端 `db.rs` 命令。

### 导出函数

| 函数 | 说明 | 调用命令 |
|------|------|----------|
| `initDatabase()` | 初始化数据库 | `init_database` |
| `getConnections()` | 获取所有连接 | `get_connections` |
| `getConnectionById(id)` | 根据 ID 获取连接 | `get_connection_by_id` |
| `saveConnection(conn)` | 保存连接 | `save_connection` |
| `deleteConnection(id)` | 删除连接 | `delete_connection` |
| `exportConnections()` | 导出连接 | `export_connections` |
| `importConnections(json)` | 导入连接 | `import_connections` |
| `migrateFromLocalStorage()` | 迁移 localStorage | `migrate_from_localstorage` |

### 数据转换

```typescript
// 前端 Connection 类型
interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  keyFile?: string
  group: string
  tags: string[]
}

// 后端 ConnectionRecord 类型
interface ConnectionRecord {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string | null
  key_file: string | null
  group_name: string | null
  tags: string | null        // JSON 字符串
  created_at: string | null
  updated_at: string | null
}
```

### 字段映射

| 前端字段 | 后端字段 | 说明 |
|----------|----------|------|
| `group` | `group_name` | 分组名称 |
| `tags` (数组) | `tags` (JSON 字符串) | 标签列表 |
| `keyFile` | `key_file` | SSH 密钥文件路径 |

### 使用示例

```typescript
import { getConnections, saveConnection, deleteConnection } from '@/services/database'

// 获取连接列表
const connections = await getConnections()

// 保存新连接
await saveConnection({
  id: 'conn-1',
  name: 'Production Server',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  password: 'secret',
  group: 'Production',
  tags: ['web', 'api']
})

// 删除连接
await deleteConnection('conn-1')
```

## 约定

- 所有函数返回 Promise
- 错误通过 `Result` 类型返回，不抛异常
- 密码在后端自动加密/解密，前端无需处理