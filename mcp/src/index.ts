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

// token 缓存：应用侧可能重置/轮换 token（~/.iterminal/mcp_token），
// 启动时读一次，收到 401 时重新读文件并重试，避免要求重启 MCP host。
let apiToken: string | null = loadApiToken();

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
  /** 命令超时被强制终止（如 tail -f），output 含超时前已收到的输出 */
  timed_out?: boolean;
  /** stdout/stderr 超过 1MB 上限被截断 */
  output_truncated?: boolean;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 字节数人类可读化：1234567 → "1.2M"（比原数字更省 token 且易读） */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}M`;
  return `${(bytes / 1073741824).toFixed(1)}G`;
}

/** Unix 秒 → "10-21 08:15"（本地时间，去年份与秒） */
function fmtUnix(seconds: number): string {
  const d = new Date(seconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO 时间 → "10-21 08:15"（去年份与秒，列表场景够用） */
function fmtTime(iso: string): string {
  return iso?.slice(5, 16).replace("T", " ") ?? "";
}



async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = 30000
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${path}`;

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    // timeoutMs <= 0 表示不限时（上传/下载大文件可能耗时很久）
    const timeoutId = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      signal: controller.signal,
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      return await fetch(url, options);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  };

  try {
    let response = await doFetch();

    // 401：应用侧 token 可能已轮换，重读 token 文件一次并重试
    if (response.status === 401) {
      const refreshed = loadApiToken();
      if (refreshed && refreshed !== apiToken) {
        apiToken = refreshed;
        response = await doFetch();
      }
    }

    if (!response.ok) {
      // 后端对业务错误统一返回 400/4xx/5xx，具体原因在 body 的 error 字段——透传给调用方
      let detail = "";
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = `：${body.error}`;
      } catch {
        // body 不是 JSON（如网关/代理错误页），仅保留状态码
      }
      return {
        success: false,
        error: response.status === 401
          ? 'HTTP 401: token 无效（已尝试重读 ~/.iterminal/mcp_token 重试仍失败，请在 iTerminal 设置中确认 MCP 已开启）'
          : `HTTP ${response.status}${detail || `: ${response.statusText}`}`,
      };
    }
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: timeoutMs > 0
          ? `请求超时（${Math.round(timeoutMs / 1000)} 秒），文件可能过大或网络较慢`
          : '请求被中断',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface HostKeyInfo {
  key_type: string;
  key: string;
  fingerprint: string;
}

interface SnippetRecord {
  id: string;
  title: string;
  command: string;
  description: string | null;
  category: string | null;
}

interface SessionLogFile {
  name: string;
  size: number;
  modified_at: number;
}

interface SshConfigEntry {
  alias: string;
  host_name: string;
  port: number;
  user: string | null;
  identity_file: string | null;
  proxy_jump: string | null;
  unsupported: string | null;
}

interface BatchExecResult {
  id: string;
  label: string;
  success: boolean;
  output: string;
  error: string | null;
  timed_out: boolean;
}

interface KnownHostRecord {
  host: string;
  port: number;
  key_type: string;
  key: string;
  fingerprint: string;
  first_seen_at: string | null;
}

const HOST_KEY_CHALLENGE_PREFIX = "HOST_KEY_CHALLENGE:";

/**
 * 连接类工具统一走这里。主机密钥需要用户确认时，后端在错误里带挑战（JSON），
 * 原样透传对 Agent 没有用——换成它下一步该做什么。
 */
async function connectTool(method: string, path: string, body?: unknown): Promise<unknown> {
  // 慢认证服务器（PAM/GSSAPI）后端最长等 30s
  const response = await apiCall<unknown>(method, path, body, 60000);
  if (response.success) return response;

  const error = response.error ?? "";
  const index = error.indexOf(HOST_KEY_CHALLENGE_PREFIX);
  if (index === -1) return response;

  let challenge: {
    kind: string;
    host: string;
    port: number;
    presented: HostKeyInfo;
    trusted?: HostKeyInfo;
  } | null = null;
  try {
    challenge = JSON.parse(error.slice(index + HOST_KEY_CHALLENGE_PREFIX.length));
  } catch {
    return response;
  }
  if (!challenge?.presented) return response;

  const { kind, host, port, presented, trusted } = challenge;
  if (kind === "changed") {
    return {
      success: false,
      host_key: "changed",
      error:
        `${host}:${port} 的主机密钥与之前信任的不一致（原 ${trusted?.key_type} ${trusted?.fingerprint}，` +
        `现为 ${presented.key_type} ${presented.fingerprint}）。可能是服务器重装，也可能是中间人攻击，` +
        "不能由你代为确认：请用户在 iTerminal 里连接一次该主机，在警告框里核对指纹后再重试",
    };
  }
  return {
    success: false,
    host_key: "unknown",
    error:
      `尚未信任 ${host}:${port} 的主机密钥（${presented.key_type}，指纹 ${presented.fingerprint}）。` +
      "iTerminal 会校验服务器身份，首次连接需要确认。向用户确认该指纹无误后，带 acceptHostKey: true " +
      "重新调用即可信任并连接；已信任的密钥见 iter_list_known_hosts",
  };
}

const tools: Tool[] = [
  {
    name: "iter_status",
    description: "检查 iTerminal API 服务状态",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_connect",
    description:
      "创建 SSH 连接（同 host:端口:用户 已有活跃连接时自动复用，不重复握手）。已保存的配置优先用 iter_quick_connect 按名称连接。认证：password、keyFile 或 authMethod=agent 三选一",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID（自定义唯一标识）" },
        host: { type: "string", description: "服务器地址" },
        port: { type: "number", description: "SSH端口，默认22" },
        username: { type: "string", description: "用户名" },
        password: { type: "string", description: "密码" },
        acceptHostKey: { type: "boolean", description: "这台主机首次连接、指纹是否已向用户核对并同意信任（等同 OpenSSH 的 accept-new），默认 false。iTerminal 会校验服务器身份：未信任时连接被拒绝并返回指纹；已信任的密钥发生变化时此参数无效，必须由用户在 iTerminal 的警告框里确认" },
        keyFile: { type: "string", description: "本机私钥文件路径，如 ~/.ssh/id_ed25519（与 password 二选一）" },
        keyPassphrase: { type: "string", description: "私钥口令（私钥本身加了口令时必填）" },
        authMethod: { type: "string", enum: ["password", "publickey", "agent"], description: "认证方式，默认按有无 keyFile 推断；agent 表示用本机 ssh-agent 里的密钥（此时不需要 password/keyFile）" },
        jumpHostId: { type: "string", description: "跳板机：一条已保存连接的 id（iter_list_saved_connections 可查），经它转发到目标主机" },
        authAnswers: { type: "array", items: { type: "string" }, description: "服务器交互式验证（动态口令、短信验证码等）提问的预备回答，按提问顺序。不传则提问弹在 iTerminal 窗口里由用户回答" },
      },
      required: ["id", "host", "username"],
    },
  },
  {
    name: "iter_disconnect",
    description: "断开 SSH 连接",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_test_connection",
    description: "测试 SSH 连通性与认证是否可用（不保持连接）",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "服务器地址" },
        port: { type: "number", description: "SSH端口，默认22" },
        username: { type: "string", description: "用户名" },
        password: { type: "string", description: "密码" },
        acceptHostKey: { type: "boolean", description: "这台主机首次连接、指纹是否已向用户核对并同意信任（等同 OpenSSH 的 accept-new），默认 false。iTerminal 会校验服务器身份：未信任时连接被拒绝并返回指纹；已信任的密钥发生变化时此参数无效，必须由用户在 iTerminal 的警告框里确认" },
        keyFile: { type: "string", description: "本机私钥文件路径，如 ~/.ssh/id_ed25519（与 password 二选一）" },
        keyPassphrase: { type: "string", description: "私钥口令（私钥本身加了口令时必填）" },
        authMethod: { type: "string", enum: ["password", "publickey", "agent"], description: "认证方式，默认按有无 keyFile 推断；agent 表示用本机 ssh-agent 里的密钥（此时不需要 password/keyFile）" },
        jumpHostId: { type: "string", description: "跳板机：一条已保存连接的 id（iter_list_saved_connections 可查），经它转发到目标主机" },
        authAnswers: { type: "array", items: { type: "string" }, description: "服务器交互式验证（动态口令、短信验证码等）提问的预备回答，按提问顺序。不传则提问弹在 iTerminal 窗口里由用户回答" },
      },
      required: ["host", "username"],
    },
  },
  {
    name: "iter_list_connections",
    description: "列出当前所有活跃的 SSH 连接",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_exec",
    description:
      "在远程服务器执行命令（同步等待结束，最长 60 秒；输出超 128KB 保留末尾）。查看日志用 tail -n 200 等有限条数，不要用 tail -f / journalctl -f 等持续输出命令——它们不会结束，60 秒后被强制终止（返回 timed_out: true 与超时前输出）。要看新输出就再次执行有限条数命令",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        command: { type: "string", description: "要执行的命令" },
      },
      required: ["id", "command"],
    },
  },
  {
    name: "iter_batch_exec",
    description:
      "在多条连接上并发执行同一条命令并汇总每台的结果（批量看磁盘、批量重启服务等）。未连接的按保存的配置临时建连、跑完即断，不会在界面打开终端。单台最长 60 秒，持续输出的命令会被强制终止并带回已有输出",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "连接 id 列表（iter_list_saved_connections / iter_list_connections 获取）" },
        command: { type: "string", description: "要执行的命令" },
        acceptHostKey: { type: "boolean", description: "同 iter_connect：临时建连时首次见到的主机密钥是否信任，默认 false" },
      },
      required: ["ids", "command"],
    },
  },
  {
    name: "iter_monitor",
    description: "获取远程服务器系统监控数据（CPU/内存/磁盘；超过 16 核时逐核占用只保留前 16）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_list_dir",
    description: "列出远程目录内容（紧凑文本：类型 名称 大小 日期；权限位请用 iter_exec 执行 ls -la）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "目录路径，默认/" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_mkdir",
    description: "在远程服务器创建目录",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "要创建的目录路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_rm",
    description: "删除远程文件",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "要删除的文件路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_rename",
    description: "重命名/移动远程文件或目录",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        old_path: { type: "string", description: "原路径" },
        new_path: { type: "string", description: "新路径" },
      },
      required: ["id", "old_path", "new_path"],
    },
  },
  {
    name: "iter_read_file",
    description: "读取远程文件内容（默认上限 64KB，超长截断；大文件用 iter_exec 执行 tail -c / sed -n 过滤读取）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "文件路径" },
        max_size: { type: "number", description: "最大读取字节数，默认65536(64KB)" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_write_file",
    description: "写入远程文件内容（整文件覆盖）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["id", "path", "content"],
    },
  },
  {
    name: "iter_upload_file",
    description:
      "上传本地文件到远程服务器（后台执行，立即返回 task_id，不等传输完成）。发起后必须用 iter_transfer_status 轮询（间隔 2-5 秒）直到 state 为 done（成功，含 bytes_transferred）或 failed（失败，含 error）。不要假定调用返回即上传完成",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        local_path: { type: "string", description: "本地文件路径" },
        remote_path: { type: "string", description: "远程目标路径" },
        use_sudo: { type: "boolean", description: "目标目录无写权限时用 sudo 提权上传，默认false" },
      },
      required: ["id", "local_path", "remote_path"],
    },
  },
  {
    name: "iter_download_file",
    description:
      "从远程服务器下载文件到本地（后台执行，立即返回 task_id，不等传输完成）。大文件（如数百 MB 日志/备份）下载需数分钟，发起后必须用 iter_transfer_status 轮询（间隔 2-5 秒）直到 state 为 done 或 failed。不要假定调用返回即下载完成",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        remote_path: { type: "string", description: "远程文件路径" },
        local_path: { type: "string", description: "本地保存路径" },
      },
      required: ["id", "remote_path", "local_path"],
    },
  },
  {
    name: "iter_transfer_status",
    description:
      "查询后台传输任务（upload/download/upload_folder 发起的）进度。返回 state(running/done/failed)、transferred 和 total（字节，total 为 0 表示未知）、error。建议每 2-5 秒轮询一次直到 done/failed",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "传输发起时返回的任务ID" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "iter_list_saved_connections",
    description: "列出保存的连接配置（紧凑文本：名称 user@host:端口 [分组] #标签；不含密码）。连接时用 iter_quick_connect 传名称或 IP 片段即可",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_quick_connect",
    description: "连接已保存的配置：支持名称、完整 IP、或 IP 片段（如 11.114 匹配 172.18.11.114）。片段匹配必须唯一，多命中会列出候选",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接名称 / IP / IP 片段 / ID" },
        acceptHostKey: { type: "boolean", description: "同 iter_connect：首次连接是否信任已核对过的主机密钥，默认 false" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_save_connection",
    description: "新建并保存 SSH 连接，可选自动连接",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "连接名称（如 web-server）" },
        host: { type: "string", description: "主机地址" },
        port: { type: "number", description: "SSH端口，默认22" },
        username: { type: "string", description: "登录用户名" },
        password: { type: "string", description: "密码（与 keyFile 二选一）" },
        keyFile: { type: "string", description: "私钥文件路径（与 password 二选一）" },
        keyPassphrase: { type: "string", description: "私钥口令" },
        authMethod: { type: "string", enum: ["password", "publickey", "agent"], description: "认证方式，默认按有无 keyFile 推断；agent 表示用本机 ssh-agent" },
        jumpHostId: { type: "string", description: "跳板机：一条已保存连接的 id" },
        autoConnect: { type: "boolean", description: "保存后立即连接，默认false" },
        acceptHostKey: { type: "boolean", description: "同 iter_connect：autoConnect 时首次连接是否信任已核对过的主机密钥，默认 false" },
      },
      required: ["name", "host", "username"],
    },
  },
  {
    name: "iter_preview_ssh_config",
    description:
      "预览用户 ~/.ssh/config 里可导入的 Host（别名 user@host:端口 [私钥] [经 跳板机]）。需要用户已有的服务器时先看这里，再用 iter_import_ssh_config 导入",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_import_ssh_config",
    description:
      "把 ~/.ssh/config 里的 Host 导入为 iTerminal 的已保存连接（之后用 iter_quick_connect 连接）。主机和用户名都相同的连接会跳过，不会重复导入",
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "string", description: "导入到的分组名，默认「默认」" },
        aliases: { type: "array", items: { type: "string" }, description: "只导入这些别名；不给则全部" },
      },
    },
  },
  {
    name: "iter_list_snippets",
    description:
      "列出用户保存的命令片段（标题 分类 命令）。片段里的 {{host}} {{port}} {{user}} {{name}} 表示目标连接信息、{{date}} {{time}} 等表示当前时间、{{input:提示}} 需向用户要一个值——执行前请自行替换成实际值；{{cursor}} 忽略",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "只看这个分类" },
        keyword: { type: "string", description: "标题/命令里包含的关键字" },
      },
    },
  },
  {
    name: "iter_list_session_logs",
    description:
      "列出 iTerminal 的终端会话日志文件，新的在前（需用户在 设置 → 终端 开启「会话日志」）。想知道用户之前在某台机器的终端里执行过什么、看到过什么输出时用",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "日志目录；默认 ~/iTerminal/logs。用户在设置里改过目录时传入" },
        limit: { type: "number", description: "最多列几条，默认 20" },
      },
    },
  },
  {
    name: "iter_read_session_log",
    description: "读一份会话日志的末尾（纯文本，已去掉颜色等转义序列）。默认取末尾 64KB",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "日志文件名，iter_list_session_logs 给出" },
        maxBytes: { type: "number", description: "取末尾多少字节，默认 65536" },
        dir: { type: "string", description: "日志目录；默认 ~/iTerminal/logs" },
      },
      required: ["name"],
    },
  },
  {
    name: "iter_list_known_hosts",
    description:
      "列出 iTerminal 已信任的主机密钥（主机:端口 算法 SHA256 指纹 首次信任时间）。连接报主机密钥未信任或已变化时，用它向用户核对",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "iter_forget_known_host",
    description:
      "忘记一台主机的已信任密钥，下次连接重新询问。只在用户确认服务器确实更换了密钥之后使用",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "主机地址" },
        port: { type: "number", description: "SSH端口，默认22" },
        keyType: { type: "string", description: "只忘掉某一种算法的密钥，如 ssh-ed25519；不给则忘掉该主机的全部" },
      },
      required: ["host"],
    },
  },
  {
    name: "iter_network_stats",
    description: "获取远程服务器网络接口统计信息",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_list_processes",
    description: "获取远程进程列表（按内存排序，默认取前 20 条，可用 top 调整，最大 100）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        top: { type: "number", description: "返回前 N 条，默认20，最大100" },
      },
      required: ["id"],
    },
  },
  {
    name: "iter_kill_process",
    description: "终止远程服务器上的进程",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        pid: { type: "number", description: "要终止的进程ID" },
      },
      required: ["id", "pid"],
    },
  },
  {
    name: "iter_compress",
    description: "压缩远程文件或目录为 .tar.gz（同步等待，不限时，大文件耗时久）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        source_path: { type: "string", description: "要压缩的文件或目录路径" },
        target_path: { type: "string", description: "目标压缩文件路径(.tar.gz)" },
      },
      required: ["id", "source_path", "target_path"],
    },
  },
  {
    name: "iter_extract",
    description: "解压远程压缩文件（同步等待，不限时，大文件耗时久）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        file_path: { type: "string", description: "压缩文件路径" },
        target_dir: { type: "string", description: "解压目标目录" },
      },
      required: ["id", "file_path", "target_dir"],
    },
  },
  {
    name: "iter_search_files",
    description: "按通配符在远程搜索文件（返回完整路径与大小；默认最多 100 条）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "搜索起始路径" },
        pattern: { type: "string", description: "搜索模式（支持通配符）" },
        max_results: { type: "number", description: "最大返回条数，默认100" },
      },
      required: ["id", "path", "pattern"],
    },
  },
  {
    name: "iter_upload_folder",
    description:
      "上传本地文件夹到远程服务器（后台执行，立即返回 task_id）。发起后用 iter_transfer_status 轮询（间隔 2-5 秒）直到 state 为 done 或 failed",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        local_path: { type: "string", description: "本地文件夹路径" },
        remote_path: { type: "string", description: "远程目标路径" },
        use_sudo: { type: "boolean", description: "目标目录无写权限时用 sudo 提权上传，默认false" },
      },
      required: ["id", "local_path", "remote_path"],
    },
  },
  {
    name: "iter_create_file",
    description: "在远程服务器创建空文件",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "要创建的文件路径" },
      },
      required: ["id", "path"],
    },
  },
  {
    name: "iter_delete_directory",
    description: "删除远程服务器上的目录",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "连接ID" },
        path: { type: "string", description: "要删除的目录路径" },
      },
      required: ["id", "path"],
    },
  },
];

const server = new Server(
  { name: "iterminal-mcp", version: "2.3.2" },
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
        const port = Number(params.port) || 22;
        // 幂等复用：同 host:port:user 已有活跃连接时直接复用，省掉一次 SSH 握手（慢认证服务器可达 30s）
        const active = await apiCall<Connection[]>("GET", "/api/connections");
        const existing = (active.data || []).find(
          (c) => c.host === params.host && c.port === port && c.username === params.username
        );
        if (existing) {
          result = { success: true, reused: true, id: existing.id, message: `已复用现有连接 ${existing.username}@${existing.host}` };
          break;
        }
        const body = {
          id: params.id,
          host: params.host,
          port,
          username: params.username,
          password: params.password,
          acceptHostKey: params.acceptHostKey === true,
          key_file: params.keyFile || null,
          key_passphrase: params.keyPassphrase || null,
          auth_method: params.authMethod || null,
          jump_host_id: params.jumpHostId || null,
          auth_answers: params.authAnswers ?? null,
        };
        result = await connectTool("POST", "/api/connections", body);
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
          acceptHostKey: params.acceptHostKey === true,
          key_file: params.keyFile || null,
          key_passphrase: params.keyPassphrase || null,
          auth_method: params.authMethod || null,
          jump_host_id: params.jumpHostId || null,
          auth_answers: params.authAnswers ?? null,
        };
        result = await connectTool("POST", "/api/connections/test", body);
        break;
      }

      case "iter_list_connections": {
        result = await apiCall<Connection[]>("GET", "/api/connections");
        break;
      }

      case "iter_exec": {
        const r = await apiCall<CommandResult>("POST", `/api/connections/${params.id}/exec`, {
          command: params.command,
        });
        // 1MB 原始输出直接进上下文会撑爆（≈25 万 token），保尾截断——日志类输出末尾最有价值
        if (r.success && r.data?.output && r.data.output.length > 131072) {
          r.data.output = `[输出超 128KB，已保留末尾；需要头部或完整输出请用更精确的命令过滤，或重定向到文件后分段读取]\n${r.data.output.slice(-131072)}`;
        }
        result = r;
        break;
      }

      case "iter_batch_exec": {
        // 不限时：后端自带超时（建连 45s + 执行 60s）
        const r = await apiCall<BatchExecResult[]>("POST", "/api/batch-exec", {
          ids: params.ids,
          command: params.command,
          acceptHostKey: params.acceptHostKey === true,
        }, 0);
        if (!r.success || !Array.isArray(r.data)) {
          result = r;
          break;
        }
        const ok = r.data.filter((x) => x.success).length;
        const lines = r.data.map((x) => {
          const mark = x.success ? "✓" : x.timed_out ? "⏱" : "✗";
          const detail = [x.error?.trimEnd(), x.output.trimEnd()].filter(Boolean).join("\n");
          // 每台只带回末尾 2000 字符：30 台机器的完整输出能把上下文吃光
          const shown =
            detail.length > 2000 ? `${detail.slice(-2000)}\n…（输出过长，只保留末尾 2000 字符）` : detail;
          return `${mark} ${x.label}${x.timed_out ? "（超时，输出不完整）" : ""}\n${shown || "（无输出）"}`;
        });
        result = `批量执行完成：成功 ${ok} / ${r.data.length}\n\n${lines.join("\n\n")}`;
        break;
      }

      case "iter_monitor": {
        const r = await apiCall<MonitorData>("GET", `/api/connections/${params.id}/monitor`);
        // 核心数很多时 per_core 数组价值低且费 token，截断保留前 16 核
        if (r.success && r.data && Array.isArray(r.data.cpu?.per_core_usage) && r.data.cpu.per_core_usage.length > 16) {
          r.data.cpu.per_core_usage = r.data.cpu.per_core_usage.slice(0, 16);
        }
        result = r;
        break;
      }

      case "iter_list_dir": {
        const path = encodeURIComponent((params.path as string) || "/");
        const r = await apiCall<FileEntry[]>("GET", `/api/connections/${params.id}/files?path=${path}`);
        if (r.success && Array.isArray(r.data)) {
          // 紧凑文本行（省略 path 前缀/permissions/年份），比 JSON 形式省约 8 倍 token
          const lines = r.data.map(
            (f) => `${f.is_directory ? "d" : "-"} ${f.name}${f.is_directory ? "/" : ""} ${fmtSize(f.size)} ${fmtTime(f.modified)}`
          );
          result = `目录 ${decodeURIComponent(path)}（${r.data.length} 项；权限位请用 iter_exec 跑 ls -la）\n${lines.join("\n")}`;
        } else {
          result = r;
        }
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
            // 默认 64KB：1MB 文本进上下文会撑爆；大文件请用 iter_exec 过滤（tail -c / sed -n 等）
            max_size: params.max_size || 65536,
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
        result = await apiCall<{ success: boolean; task_id: string; state: string }>(
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
        result = await apiCall<{ success: boolean; task_id: string; state: string }>(
          "POST",
          `/api/connections/${params.id}/download`,
          {
            remote_path: params.remote_path,
            local_path: params.local_path,
          }
        );
        break;
      }

      case "iter_transfer_status": {
        result = await apiCall<{
          kind: string;
          state: string;
          transferred: number;
          total: number;
          error: string | null;
        }>("GET", `/api/transfers/${params.task_id}`);
        break;
      }

      case "iter_list_saved_connections": {
        const r = await apiCall<ConnectionRecord[]>("GET", "/api/saved-connections");
        if (r.success && Array.isArray(r.data)) {
          // 紧凑文本行：省略 UUID/时间戳等对 LLM 无语义的字段（连接用 iter_quick_connect 传名称即可）
          const lines = r.data.map((c) => {
            const parts = [c.name, `${c.username}@${c.host}:${c.port}`];
            if (c.group_name) parts.push(`[${c.group_name}]`);
            if (c.tags?.length) parts.push(c.tags.map((t) => `#${t}`).join(" "));
            if (c.key_file) parts.push(`key=${c.key_file}`);
            return parts.join(" ");
          });
          result = `已保存 ${r.data.length} 个连接（iter_quick_connect 传名称或 IP 片段即可连接）\n${lines.join("\n")}`;
        } else {
          result = r;
        }
        break;
      }

      case "iter_quick_connect": {
        const key = String(params.id ?? "");
        let connId = key;
        // 非 UUID 一律按键解析：精确名称 → 精确 host → 名称/host 包含（IP 片段如 "11.114" 匹配 172.18.11.114）
        if (key && !UUID_RE.test(key)) {
          const list = await apiCall<ConnectionRecord[]>("GET", "/api/saved-connections");
          const records = list.data || [];
          let matches = records.filter((c) => c.name === key);
          if (matches.length === 0) matches = records.filter((c) => c.host === key);
          if (matches.length === 0) {
            matches = records.filter((c) => c.name.includes(key) || c.host.includes(key));
          }
          if (matches.length === 0) {
            result = {
              success: false,
              error: `没有匹配 "${key}" 的连接，可用 iter_list_saved_connections 查看全部`,
            };
            break;
          }
          if (matches.length > 1) {
            // 片段多命中时不能猜——列出候选让调用方精确化（连错服务器比多问一步代价大）
            const candidates = matches.slice(0, 10).map((c) => `${c.name} ${c.username}@${c.host}`).join("\n");
            result = {
              success: false,
              error: `"${key}" 匹配到 ${matches.length} 个连接，请用更长的 IP 片段或名称指定其一：\n${candidates}`,
            };
            break;
          }
          connId = matches[0].id;
        }
        result = await connectTool(
          "POST",
          `/api/saved-connections/${encodeURIComponent(connId)}/connect`,
          params.acceptHostKey === true ? { acceptHostKey: true } : undefined,
        );
        break;
      }

      case "iter_save_connection": {
        result = await connectTool("POST", "/api/saved-connections", {
          name: params.name,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          // 后端字段是 snake_case：此前传 keyFile 被忽略，经 MCP 保存的连接一直丢私钥配置
          key_file: params.keyFile || null,
          key_passphrase: params.keyPassphrase || null,
          auth_method: params.authMethod || null,
          jump_host_id: params.jumpHostId || null,
          autoConnect: params.autoConnect ?? false,
          acceptHostKey: params.acceptHostKey === true,
        });
        break;
      }

      case "iter_preview_ssh_config": {
        const r = await apiCall<SshConfigEntry[]>("GET", "/api/ssh-config");
        if (r.success && Array.isArray(r.data)) {
          result =
            r.data.length === 0
              ? "~/.ssh/config 里没有可导入的 Host"
              : r.data
                  .map((e) => {
                    const parts = [e.alias, `${e.user ?? "<本机用户>"}@${e.host_name}:${e.port}`];
                    if (e.identity_file) parts.push(`key=${e.identity_file}`);
                    if (e.proxy_jump) parts.push(`via=${e.proxy_jump}`);
                    if (e.unsupported) parts.push(`[不支持: ${e.unsupported}]`);
                    return parts.join(" ");
                  })
                  .join("\n");
        } else {
          result = r;
        }
        break;
      }

      case "iter_import_ssh_config": {
        result = await apiCall<{ imported: number; skipped: string[] }>("POST", "/api/ssh-config/import", {
          group: params.group,
          aliases: params.aliases,
        });
        break;
      }

      case "iter_list_snippets": {
        const query = params.category ? `?category=${encodeURIComponent(String(params.category))}` : "";
        const r = await apiCall<SnippetRecord[]>("GET", `/api/snippets${query}`);
        if (r.success && Array.isArray(r.data)) {
          const keyword = params.keyword ? String(params.keyword).toLowerCase() : "";
          const items = r.data.filter((s) => !keyword || `${s.title} ${s.command}`.toLowerCase().includes(keyword));
          result =
            items.length === 0
              ? "没有匹配的片段"
              : `共 ${items.length} 条片段\n` +
                items.map((s) => `${s.title}${s.category ? ` [${s.category}]` : ""}: ${s.command}${s.description ? ` — ${s.description}` : ""}`).join("\n");
        } else {
          result = r;
        }
        break;
      }

      case "iter_list_session_logs": {
        const limit = Number(params.limit);
        const query = new URLSearchParams();
        if (params.dir) query.set("dir", String(params.dir));
        if (params.limit && limit > 0) query.set("limit", String(Math.floor(limit)));
        const r = await apiCall<SessionLogFile[]>("GET", `/api/session-logs?${query}`);
        if (r.success && Array.isArray(r.data)) {
          result =
            r.data.length === 0
              ? "还没有会话日志（用户可能没开启会话日志，或开启后还没有终端输出）"
              : `共 ${r.data.length} 份日志，新的在前\n` +
                r.data.map((f) => `${f.name} (${fmtSize(f.size)}, ${fmtUnix(f.modified_at)})`).join("\n");
        } else {
          result = r;
        }
        break;
      }

      case "iter_read_session_log": {
        const query = new URLSearchParams({ name: String(params.name ?? "") });
        if (params.dir) query.set("dir", String(params.dir));
        const maxBytes = Number(params.maxBytes);
        if (params.maxBytes && maxBytes > 0) query.set("max_bytes", String(Math.floor(maxBytes)));
        const r = await apiCall<{ name: string; size: number; truncated: boolean; content: string }>(
          "GET",
          `/api/session-logs/read?${query}`
        );
        if (r.success && r.data) {
          result = `${r.data.name}（${fmtSize(r.data.size)}${r.data.truncated ? "，只显示末尾" : ""}）\n\n${r.data.content}`;
        } else {
          result = r;
        }
        break;
      }

      case "iter_list_known_hosts": {
        const r = await apiCall<KnownHostRecord[]>("GET", "/api/known-hosts");
        if (r.success && Array.isArray(r.data)) {
          result =
            r.data.length === 0
              ? "还没有信任过任何主机"
              : `已信任 ${r.data.length} 条主机密钥\n` +
                r.data
                  .map(
                    (k) =>
                      `${k.host}:${k.port} ${k.key_type} ${k.fingerprint}` +
                      (k.first_seen_at ? ` (${fmtTime(k.first_seen_at)})` : "")
                  )
                  .join("\n");
        } else {
          result = r;
        }
        break;
      }

      case "iter_forget_known_host": {
        const query = new URLSearchParams({ host: String(params.host), port: String(Number(params.port) || 22) });
        if (params.keyType) query.set("key_type", String(params.keyType));
        result = await apiCall<boolean>("DELETE", `/api/known-hosts?${query}`);
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
        const top = Math.min(Math.max(Number(params.top) || 20, 1), 100);
        const r = await apiCall<Array<{ pid: number; user: string; cpu: number; mem: number; vsz: number; rss: number; command: string }>>(
          "GET",
          `/api/connections/${params.id}/processes`
        );
        if (r.success && Array.isArray(r.data)) {
          // 紧凑文本行；全量进程列表（数百条×7字段 JSON）非常耗 token
          const lines = r.data.slice(0, top).map(
            (p) => `${p.pid} ${p.user} ${p.cpu}% ${p.mem}% ${fmtSize(p.rss * 1024)} ${p.command.slice(0, 80)}`
          );
          result = `Top ${Math.min(top, r.data.length)} 进程 / 共 ${r.data.length}（按内存排序；rss 为物理内存）\npid user cpu mem rss command\n${lines.join("\n")}`;
        } else {
          result = r;
        }
        break;
      }

      case "iter_kill_process": {
        result = await apiCall<boolean>("POST", `/api/connections/${params.id}/kill-process`, {
          pid: params.pid,
        });
        break;
      }

      case "iter_compress": {
        result = await apiCall<{ success: boolean; error?: string }>(
          "POST",
          `/api/connections/${params.id}/compress`,
          {
            source_path: params.source_path,
            target_path: params.target_path,
          },
          0  // 不限时（大文件压缩耗时久）
        );
        break;
      }

      case "iter_extract": {
        result = await apiCall<{ success: boolean; error?: string }>(
          "POST",
          `/api/connections/${params.id}/extract`,
          {
            file_path: params.file_path,
            target_dir: params.target_dir,
          },
          0  // 不限时（大文件解压耗时久）
        );
        break;
      }

      case "iter_search_files": {
        const r = await apiCall<Array<{ name: string; path: string; is_directory: boolean; size: number; modified: string }>>(
          "GET",
          `/api/connections/${params.id}/search-files?path=${encodeURIComponent(params.path as string)}&pattern=${encodeURIComponent(params.pattern as string)}&max_results=${params.max_results || 100}`
        );
        if (r.success && Array.isArray(r.data)) {
          // 搜索结果跨目录，path 必须完整；省略 name（path 已含）与 modified
          const lines = r.data.map((f) => `${f.is_directory ? "d" : "-"} ${f.path} ${fmtSize(f.size)}`);
          result = `${r.data.length} 个匹配\n${lines.join("\n")}`;
        } else {
          result = r;
        }
        break;
      }

      case "iter_upload_folder": {
        result = await apiCall<{ success: boolean; task_id: string; state: string }>(
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
      // 紧凑序列化（无缩进）：缩进空格在 LLM 上下文里是纯浪费，约省 30% token；
      // 部分工具已在 case 内格式化为文本（list_dir/processes/saved-connections 等），直接透传
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
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