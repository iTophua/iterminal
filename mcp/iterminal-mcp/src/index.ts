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

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  return response.json();
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