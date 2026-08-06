#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const API_BASE = "http://127.0.0.1:27149";

/**
 * 读取 iTerminal API 鉴权 token。
 * token 由 iTerminal 应用生成，写入 ~/.iterminal/mcp_token（权限 0600）。
 */
function loadApiToken(): string | null {
  const paths = [
    join(homedir(), ".iterminal", "mcp_token"),
    join(homedir(), ".config", "iterminal", "mcp_token"), // XDG fallback
  ];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        return readFileSync(p, "utf-8").trim();
      }
    } catch {
      // 读取失败（权限等），尝试下一个路径
    }
  }
  return null;
}

const API_TOKEN = loadApiToken();

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
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    },
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
    description: "上传本地文件到远程服务器。参数: id(连接标识), local_path(本地文件路径), remote_path(远程目标路径)。可选 use_sudo: 目标目录无写权限时用 sudo 提权上传（默认 false）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        local_path: { type: "string", description: "本地文件路径" },
        remote_path: { type: "string", description: "远程目标路径" },
        use_sudo: { type: "boolean", description: "权限不足时用 sudo 提权上传（默认 false）" },
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
  {
    name: "iter_save_connection",
    description: "新建并保存一个 SSH 连接，可选自动连接。保存后可通过 iter_list_saved_connections 查看。" +
      "参数: name(名称), host(主机), port(端口,默认22), username(用户名), password(密码), keyFile(私钥路径), autoConnect(是否立即连接,默认false)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "连接名称（如 web-server）" },
        host: { type: "string", description: "主机地址" },
        port: { type: "number", description: "SSH 端口，默认 22" },
        username: { type: "string", description: "登录用户名" },
        password: { type: "string", description: "密码（与 keyFile 二选一）" },
        keyFile: { type: "string", description: "私钥文件路径（与 password 二选一）" },
        autoConnect: { type: "boolean", description: "是否保存后自动连接，默认 false" },
      },
      required: ["name", "host", "username"],
    },
  },
  {
    name: "iter_network_stats",
    description: "获取远程服务器网络接口统计信息。参数: id(连接标识)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_list_processes",
    description: "获取远程服务器进程列表（按内存排序）。参数: id(连接标识)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_kill_process",
    description: "终止远程服务器上的进程。参数: id(连接标识), pid(进程ID)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        pid: { type: "number", description: "要终止的进程ID" },
      },
      required: ["id", "pid"],
    },
  },
  {
    name: "iter_compress",
    description: "压缩远程服务器上的文件或目录。参数: id(连接标识), source_path(源路径), target_path(目标压缩文件路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        source_path: { type: "string", description: "要压缩的文件或目录路径" },
        target_path: { type: "string", description: "压缩后的目标文件路径(.tar.gz)" },
      },
      required: ["id", "source_path", "target_path"],
    },
  },
  {
    name: "iter_extract",
    description: "解压远程服务器上的压缩文件。参数: id(连接标识), file_path(压缩文件路径), target_dir(目标目录)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        file_path: { type: "string", description: "压缩文件路径" },
        target_dir: { type: "string", description: "解压目标目录" },
      },
      required: ["id", "file_path", "target_dir"],
    },
  },
  {
    name: "iter_search_files",
    description: "在远程服务器上搜索文件。参数: id(连接标识), path(搜索起始路径), pattern(搜索模式), max_results(最大结果数,默认100)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "搜索起始路径" },
        pattern: { type: "string", description: "搜索模式(支持通配符)" },
        max_results: { type: "number", description: "最大返回结果数,默认100" },
      },
      required: ["id", "path", "pattern"],
    },
  },
  {
    name: "iter_upload_folder",
    description: "上传本地文件夹到远程服务器。参数: id(连接标识), local_path(本地文件夹路径), remote_path(远程目标路径)。可选 use_sudo: 目标目录无写权限时用 sudo 提权上传（默认 false）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        local_path: { type: "string", description: "本地文件夹路径" },
        remote_path: { type: "string", description: "远程目标路径" },
        use_sudo: { type: "boolean", description: "权限不足时用 sudo 提权上传（默认 false）" },
      },
      required: ["id", "local_path", "remote_path"],
    },
  },
  {
    name: "iter_create_file",
    description: "在远程服务器创建空文件。参数: id(连接标识), path(文件路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "要创建的文件路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_delete_directory",
    description: "删除远程服务器上的目录。参数: id(连接标识), path(目录路径)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接标识符" },
        path: { type: "string", description: "要删除的目录路径" },
      },
      required: ["id", "path"],
    },
  },
];

const server = new Server(
  { name: "iterminal-mcp", version: "2.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
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
            ...(params.use_sudo === true ? { use_sudo: true } : {}),
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

      case "iter_save_connection": {
        result = await apiCall<string>("POST", "/api/saved-connections", {
          name: params.name,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          keyFile: params.keyFile,
          autoConnect: params.autoConnect ?? false,
        });
        break;
      }

      case "iter_network_stats": {
        result = await apiCall<{ interfaces: Array<{ name: string; rx_bytes: number; rx_packets: number; rx_errors: number; tx_bytes: number; tx_packets: number; tx_errors: number }> }>(
          "GET",
          `/api/connections/${params.id}/network-stats`
        );
        break;
      }

      case "iter_list_processes": {
        result = await apiCall<Array<{ pid: number; user: string; cpu: number; mem: number; vsz: number; rss: number; command: string }>>(
          "GET",
          `/api/connections/${params.id}/processes`
        );
        break;
      }

      case "iter_kill_process": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/kill-process`, {
          pid: params.pid,
        });
        break;
      }

      case "iter_compress": {
        result = await apiCall<{ success: boolean; error?: string }>("POST", `/api/connections/${params.id}/compress`, {
          source_path: params.source_path,
          target_path: params.target_path,
        });
        break;
      }

      case "iter_extract": {
        result = await apiCall<{ success: boolean; error?: string }>("POST", `/api/connections/${params.id}/extract`, {
          file_path: params.file_path,
          target_dir: params.target_dir,
        });
        break;
      }

      case "iter_search_files": {
        result = await apiCall<Array<{ name: string; path: string; is_directory: boolean; size: number; modified: string }>>(
          "GET",
          `/api/connections/${params.id}/search-files?path=${encodeURIComponent(params.path as string)}&pattern=${encodeURIComponent(params.pattern as string)}&max_results=${params.max_results || 100}`
        );
        break;
      }

      case "iter_upload_folder": {
        result = await apiCall<{ success: boolean; bytes_transferred: number; error?: string }>(
          "POST",
          `/api/connections/${params.id}/upload-folder`,
          {
            local_path: params.local_path,
            remote_path: params.remote_path,
            ...(params.use_sudo === true ? { use_sudo: true } : {}),
          }
        );
        break;
      }

      case "iter_create_file": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/create-file`, {
          path: params.path,
        });
        break;
      }

      case "iter_delete_directory": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/delete-directory`, {
          path: params.path,
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

// ============ Resources：文件树 ============

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const result = await apiCall<Connection[]>("GET", "/api/connections");
  const resources = (result.data || []).map((c) => ({
    uri: `iterminal://${c.id}/`,
    name: `${c.username}@${c.host}`,
    description: `SSH 连接 ${c.username}@${c.host}:${c.port} 的文件系统`,
    mimeType: "text/directory",
  }));
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  // uri 格式: iterminal://{connectionId}/{path}
  const uri = request.params.uri;
  const match = uri.match(/^iterminal:\/\/([^/]+)\/(.*)$/);
  if (!match) {
    throw new Error(`Invalid URI format: ${uri}`);
  }
  const [, connId, rawPath] = match;
  const path = decodeURIComponent(rawPath) || "/";

  // 尝试列目录
  const listResult = await apiCall<Array<{ name: string; path: string; is_directory: boolean; size: number; modified: string }>>(
    "GET",
    `/api/connections/${connId}/files?path=${encodeURIComponent(path)}`
  );

  if (listResult.success && listResult.data) {
    // 目录 → 返回文件列表
    const listing = listResult.data
      .map((f) => `${f.is_directory ? "📁" : "📄"} ${f.name}${f.is_directory ? "/" : ""}\t${f.size} bytes\t${f.modified}`)
      .join("\n");
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: `目录: ${path}\n\n${listing}`,
        },
      ],
    };
  }

  // 目录列表失败 → 可能是文件，尝试读内容
  const readResult = await apiCall<{ path: string; content: string; size: number; encoding: string }>(
    "POST",
    `/api/connections/${connId}/read_file`,
    { path }
  );

  if (readResult.success && readResult.data) {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: readResult.data.content,
        },
      ],
    };
  }

  throw new Error(`无法读取 ${path}: ${listResult.error || readResult.error}`);
});

// ============ Prompts：运维命令模板 ============

const prompts = [
  {
    name: "troubleshoot-high-cpu",
    description: "诊断服务器 CPU 占用过高的完整排查流程",
    arguments: [
      { name: "connection_id", description: "已连接的服务器 ID", required: true },
      { name: "process_hint", description: "可疑进程名（可选）", required: false },
    ],
  },
  {
    name: "check-disk-space",
    description: "检查磁盘空间使用情况并找出大文件",
    arguments: [
      { name: "connection_id", description: "已连接的服务器 ID", required: true },
    ],
  },
  {
    name: "analyze-logs",
    description: "分析指定服务的日志文件",
    arguments: [
      { name: "connection_id", description: "已连接的服务器 ID", required: true },
      { name: "service", description: "服务名（如 nginx, mysql, sshd）", required: true },
      { name: "lines", description: "查看最近 N 行（默认 100）", required: false },
    ],
  },
  {
    name: "check-network",
    description: "网络连接性诊断（监听端口/活动连接/防火墙）",
    arguments: [
      { name: "connection_id", description: "已连接的服务器 ID", required: true },
    ],
  },
  {
    name: "security-audit",
    description: "基础安全审计（登录用户/SSH 配置/异常进程）",
    arguments: [
      { name: "connection_id", description: "已连接的服务器 ID", required: true },
    ],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const connId = args?.connection_id || "<connection_id>";
  const processHint = args?.process_hint;
  const service = args?.service || "nginx";
  const lines = args?.lines || "100";

  const templates: Record<string, { role: string; content: { type: string; text: string } }[]> = {
    "troubleshoot-high-cpu": [
      {
        role: "user",
        content: {
          type: "text",
          text: `请帮我在连接 ${connId} 上排查 CPU 占用过高的问题。\n\n请依次执行以下命令并分析：\n1. 用 iter_exec 执行 \`top -bn1 | head -20\` 查看整体 CPU 使用和占用最高的进程\n2. 用 iter_exec 执行 \`ps aux --sort=-%cpu | head -10\` 查看 CPU 排名${processHint ? `\n3. 重点关注进程名包含 "${processHint}" 的进程` : ""}\n\n分析完后给出具体的优化建议。`,
        },
      },
    ],
    "check-disk-space": [
      {
        role: "user",
        content: {
          type: "text",
          text: `请帮我在连接 ${connId} 上检查磁盘空间：\n\n1. 用 iter_exec 执行 \`df -h\` 查看各分区使用率\n2. 对使用率超过 80% 的分区，用 iter_exec 执行 \`du -sh /* 2>/dev/null | sort -rh | head -10\` 找大目录\n3. 给出清理建议（日志/缓存/临时文件等）`,
        },
      },
    ],
    "analyze-logs": [
      {
        role: "user",
        content: {
          type: "text",
          text: `请在连接 ${connId} 上分析 ${service} 的日志：\n\n1. 用 iter_exec 执行 \`journalctl -u ${service} --no-pager -n ${lines}\` 查看最近 ${lines} 行\n2. 如果 journalctl 没有数据，尝试常见日志路径（/var/log/${service}/error.log 等）\n3. 找出 ERROR/WARN/FATAL 级别的日志并解释原因`,
        },
      },
    ],
    "check-network": [
      {
        role: "user",
        content: {
          type: "text",
          text: `请在连接 ${connId} 上做网络诊断：\n\n1. 用 iter_exec 执行 \`ss -tlnp\` 查看监听端口\n2. 用 iter_exec 执行 \`ss -tnp | head -20\` 查看活动连接\n3. 用 iter_exec 执行 \`iptables -L -n | head -30\` 查看防火墙规则\n4. 分析是否有异常端口或可疑连接`,
        },
      },
    ],
    "security-audit": [
      {
        role: "user",
        content: {
          type: "text",
          text: `请在连接 ${connId} 上做基础安全审计：\n\n1. 用 iter_exec 执行 \`who\` 查看当前登录用户\n2. 用 iter_exec 执行 \`last -20\` 查看最近登录记录\n3. 用 iter_exec 执行 \`grep -v "^#" /etc/ssh/sshd_config | grep -E "PermitRootLogin|PasswordAuthentication|Port "\` 检查 SSH 配置\n4. 用 iter_list_processes 查看是否有可疑进程\n5. 给出安全加固建议`,
        },
      },
    ],
  };

  const messages = templates[name];
  if (!messages) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  return { messages };
});

// ============ 多传输支持 ============

async function main() {
  const transportMode = process.env.ITERMINAL_MCP_TRANSPORT || "stdio";

  if (transportMode === "sse") {
    // SSE 传输模式：启动 HTTP server（需安装 express optional dependency）
    const port = parseInt(process.env.ITERMINAL_MCP_PORT || "3107", 10);
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
    // @ts-ignore — express 是 optionalDependency，仅 SSE 模式需要
    const express = (await import("express")).default;

    const app = express();
    let transport: any = null;

    app.get("/sse", async (req: any, res: any) => {
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });

    app.post("/messages", async (req: any, res: any) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).json({ error: "No active SSE connection" });
      }
    });

    app.listen(port, "127.0.0.1", () => {
      console.error(`iTerminal MCP Server (SSE) running on http://127.0.0.1:${port}/sse`);
    });
  } else {
    // 默认 stdio 传输
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("iTerminal MCP Server running on stdio");
  }
}

main().catch(console.error);