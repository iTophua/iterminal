#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = "http://127.0.0.1:27149";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Connection {
  id: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
}

interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
}

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified: string;
  permissions?: string;
}

interface MonitorData {
  system: {
    hostname: string;
    os: string;
    kernel: string;
    uptime: string;
  };
  cpu: {
    usage: number;
    cores: number;
    load_avg: string;
    per_core_usage: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage_percent: number;
    swap_total: number;
    swap_used: number;
  };
  disks: Array<{
    filesystem: string;
    mount_point: string;
    total: number;
    used: number;
    available: number;
    usage_percent: number;
  }>;
}

interface ApiOperation {
  timestamp: string;
  operation: string;
  connection_id: string | null;
  details: string;
  success: boolean;
  error: string | null;
}

interface ConnectionRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  group_name: string | null;
  tags: string[];
  key_file: string | null;
  created_at: string;
  updated_at: string;
}

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout after 30 seconds',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

const tools: Tool[] = [
  {
    name: "iter_status",
    description: "检查 iTerminal API 服务状态",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_connect",
    description: "创建 SSH 连接。参数: id(唯一标识), host(主机地址), port(端口,默认22), username(用户名), password(密码)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接唯一标识符" },
        host: { type: "string", description: "服务器地址" },
        port: { type: "number", description: "SSH端口,默认22" },
        username: { type: "string", description: "用户名" },
        password: { type: "string", description: "密码" },
      },
      required: ["id", "host", "username", "password"],
    },
  },
  {
    name: "iter_disconnect",
    description: "断开 SSH 连接。参数: id(连接标识)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_test_connection",
    description: "测试 SSH 连接是否可用(不保持连接)。参数: host, port, username, password",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "服务器地址" },
        port: { type: "number", description: "SSH端口,默认22" },
        username: { type: "string", description: "用户名" },
        password: { type: "string", description: "密码" },
      },
      required: ["host", "username", "password"],
    },
  },
  {
    name: "iter_list_connections",
    description: "列出当前所有活跃的 SSH 连接",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_exec",
    description: "在远程服务器执行命令。参数: id(连接标识), command(要执行的命令)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        command: { type: "string", description: "要执行的命令" },
      },
      required: ["id", "command"],
    },
  },
  {
    name: "iter_monitor",
    description: "获取远程服务器系统监控数据(CPU/内存/磁盘)。参数: id(连接标识)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_list_dir",
    description: "列出远程目录内容。参数: id(连接标识), path(目录路径,默认/)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "目录路径", default: "/" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_mkdir",
    description: "在远程服务器创建目录。参数: id(连接标识), path(目录路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "要创建的目录路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_rm",
    description: "删除远程文件。参数: id(连接标识), path(文件路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "要删除的文件路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_rename",
    description: "重命名远程文件或目录。参数: id(连接标识), old_path(原路径), new_path(新路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        old_path: { type: "string", description: "原路径" },
        new_path: { type: "string", description: "新路径" },
      },
      required: ["id", "old_path", "new_path"],
    },
  },
  {
    name: "iter_read_file",
    description: "读取远程文件内容。参数: id(连接标识), path(文件路径), max_size(最大字节数,默认1MB)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "文件路径" },
        max_size: { type: "number", description: "最大读取字节数,默认1048576(1MB)" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_write_file",
    description: "写入远程文件内容。参数: id(连接标识), path(文件路径), content(文件内容)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["id", "path", "content"],
    },
  },
  {
    name: "iter_upload_file",
    description: "上传本地文件到远程服务器。参数: id(连接标识), local_path(本地文件路径), remote_path(远程目标路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        local_path: { type: "string", description: "本地文件路径" },
        remote_path: { type: "string", description: "远程目标路径" },
      },
      required: ["id", "local_path", "remote_path"],
    },
  },
  {
    name: "iter_download_file",
    description: "从远程服务器下载文件到本地。参数: id(连接标识), remote_path(远程文件路径), local_path(本地保存路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        remote_path: { type: "string", description: "远程文件路径" },
        local_path: { type: "string", description: "本地保存路径" },
      },
      required: ["id", "remote_path", "local_path"],
    },
  },
  {
    name: "iter_list_saved_connections",
    description: "列出数据库中保存的所有 SSH 连接配置（不包含密码）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_quick_connect",
    description: "使用保存的连接配置快速建立 SSH 连接。参数: id(保存的连接ID)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "保存的连接ID" },
      },
      required: ["id"],
    },
  },
];

const server = new Server(
  { name: "iterminal-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = args || {};

  try {
    let result: unknown;

    switch (name) {
      case "iter_status": {
        result = await apiCall<Record<string, unknown>>("GET", "/api/status");
        break;
      }

      case "iter_connect": {
        const body = {
          id: params.id,
          host: params.host,
          port: params.port || 22,
          username: params.username,
          password: params.password,
        };
        result = await apiCall<string>("POST", "/api/connections", body);
        break;
      }

      case "iter_disconnect": {
        result = await apiCall<boolean>("DELETE", `/api/connections/${params.id}`);
        break;
      }

      case "iter_test_connection": {
        const body = {
          id: `test-${Date.now()}`,
          host: params.host,
          port: params.port || 22,
          username: params.username,
          password: params.password,
        };
        result = await apiCall<boolean>("POST", "/api/connections/test", body);
        break;
      }

      case "iter_list_connections": {
        result = await apiCall<Connection[]>("GET", "/api/connections");
        break;
      }

      case "iter_exec": {
        result = await apiCall<CommandResult>("POST", `/api/connections/${params.id}/exec`, {
          command: params.command,
        });
        break;
      }

      case "iter_monitor": {
        result = await apiCall<MonitorData>("GET", `/api/connections/${params.id}/monitor`);
        break;
      }

      case "iter_list_dir": {
        const path = encodeURIComponent((params.path as string) || "/");
        result = await apiCall<FileEntry[]>("GET", `/api/connections/${params.id}/files?path=${path}`);
        break;
      }

      case "iter_mkdir": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/mkdir`, {
          path: params.path,
        });
        break;
      }

      case "iter_rm": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/rm`, {
          path: params.path,
        });
        break;
      }

      case "iter_rename": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/rename`, {
          old_path: params.old_path,
          new_path: params.new_path,
        });
        break;
      }

      case "iter_read_file": {
        result = await apiCall<{ content: string; size: number; truncated: boolean; encoding: string }>(
          "POST",
          `/api/connections/${params.id}/read_file`,
          {
            path: params.path,
            max_size: params.max_size || 1048576,
          }
        );
        break;
      }

      case "iter_write_file": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/write_file`, {
          path: params.path,
          content: params.content,
        });
        break;
      }

      case "iter_upload_file": {
        result = await apiCall<{ success: boolean; bytes_transferred: number; error?: string }>(
          "POST",
          `/api/connections/${params.id}/upload`,
          {
            local_path: params.local_path,
            remote_path: params.remote_path,
          }
        );
        break;
      }

      case "iter_download_file": {
        result = await apiCall<{ success: boolean; bytes_transferred: number; error?: string }>(
          "POST",
          `/api/connections/${params.id}/download`,
          {
            remote_path: params.remote_path,
            local_path: params.local_path,
          }
        );
        break;
      }

      case "iter_list_saved_connections": {
        result = await apiCall<ConnectionRecord[]>("GET", "/api/saved-connections");
        break;
      }

      case "iter_quick_connect": {
        result = await apiCall<string>("POST", `/api/saved-connections/${params.id}/connect`);
        break;
      }

      default:
        return {
          content: [{ type: "text", text: `未知工具: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `错误: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("iTerminal MCP Server running on stdio");
}

main().catch(console.error);