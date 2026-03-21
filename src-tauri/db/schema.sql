-- iTerminal Database Schema
-- SQLite 数据库结构

-- 连接配置表
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    password TEXT,                          -- AES-256-GCM 加密存储
    key_file TEXT,                          -- SSH 密钥文件路径
    group_name TEXT,                        -- 分组名称
    tags TEXT,                              -- JSON 数组字符串
    last_connected_at TEXT,                 -- 最近连接时间 (ISO 8601)
    sort_order INTEGER DEFAULT 0,           -- 排序顺序
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 应用设置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 分组表
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_connections_group ON connections(group_name);
CREATE INDEX IF NOT EXISTS idx_connections_last_connected ON connections(last_connected_at);
CREATE INDEX IF NOT EXISTS idx_connections_sort_order ON connections(sort_order);