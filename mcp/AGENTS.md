# iTerminal MCP Server

**Generated:** 2026-03-22
**Domain:** SSH Connection Bridge

## OVERVIEW

MCP bridge exposing iTerminal's SSH capabilities via stdio transport. Proxies to local HTTP API at `:27149`.

## WHERE TO LOOK

| Symbol | Type | Purpose |
|--------|------|---------|
| `apiCall<T>()` | function | Generic HTTP wrapper for all API requests |
| `iter_connect` | tool | Create persistent SSH connection |
| `iter_exec` | tool | Execute command on connected host |
| `iter_monitor` | tool | Get CPU/memory/disk metrics |
| `iter_network_stats` | tool | Get network interface statistics |
| `iter_list_processes` | tool | List processes on remote host |
| `iter_kill_process` | tool | Terminate a process by PID |
| `iter_list_dir` | tool | List remote directory contents |
| `iter_mkdir/rm/rename` | tools | File operations |
| `iter_read_file/write_file` | tools | File content operations |
| `iter_upload_file/download_file` | tools | File transfer operations |
| `iter_upload_folder` | tool | Upload folder recursively |
| `iter_compress/extract` | tools | Archive operations |
| `iter_search_files` | tool | Search files on remote host |
| `iter_create_file` | tool | Create empty file |
| `iter_delete_directory` | tool | Delete directory |
| `iter_list_saved_connections` | tool | List saved connections from database |
| `iter_quick_connect` | tool | Quick connect using saved config |
| `iter_status` | tool | Check API service health |
| `tools[]` | const | Tool definitions with JSON schemas |
| `ApiResponse<T>` | interface | Standard API response wrapper |
| `Connection` | interface | SSH connection metadata |
| `ConnectionRecord` | interface | Saved connection from database |
| `CommandResult` | interface | Command execution output |
| `MonitorData` | interface | System metrics structure |
| `NetworkStats` | interface | Network interface statistics |
| `ProcessInfo` | interface | Process information |
| `FileEntry` | interface | Remote file metadata |
| `SearchResult` | interface | File search result |

## TOOL NAMING CONVENTION

All tools prefixed with `iter_` to avoid collisions.

| Pattern | Example |
|---------|---------|
| Connection mgmt | `iter_connect`, `iter_disconnect`, `iter_list_connections` |
| Saved connections | `iter_list_saved_connections`, `iter_quick_connect` |
| Command exec | `iter_exec` |
| Monitoring | `iter_monitor`, `iter_network_stats`, `iter_list_processes`, `iter_kill_process` |
| File ops | `iter_list_dir`, `iter_mkdir`, `iter_rm`, `iter_rename`, `iter_create_file`, `iter_delete_directory` |
| File content | `iter_read_file`, `iter_write_file` |
| File transfer | `iter_upload_file`, `iter_download_file`, `iter_upload_folder` |
| Archive ops | `iter_compress`, `iter_extract` |
| Search | `iter_search_files` |
| Health check | `iter_status` |

## API PATTERNS

**HTTP Base:** `http://127.0.0.1:27149`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Health | GET | `/api/status` | Service availability |
| Connect | POST | `/api/connections` | Body: {id, host, port, username, password} |
| Disconnect | DELETE | `/api/connections/{id}` | Close specific connection |
| Exec | POST | `/api/connections/{id}/exec` | Body: {command} |
| Monitor | GET | `/api/connections/{id}/monitor` | Returns MonitorData |
| Network stats | GET | `/api/connections/{id}/network-stats` | Returns NetworkStats |
| List processes | GET | `/api/connections/{id}/processes` | Returns ProcessInfo[] |
| Kill process | POST | `/api/connections/{id}/kill-process` | Body: {pid} |
| List dir | GET | `/api/connections/{id}/files?path=` | URL-encoded path |
| Mkdir | POST | `/api/connections/{id}/mkdir` | Body: {path} |
| Remove | POST | `/api/connections/{id}/rm` | Body: {path} |
| Rename | POST | `/api/connections/{id}/rename` | Body: {old_path, new_path} |
| Read file | POST | `/api/connections/{id}/read_file` | Body: {path, max_size} |
| Write file | POST | `/api/connections/{id}/write_file` | Body: {path, content} |
| Upload file | POST | `/api/connections/{id}/upload` | Body: {local_path, remote_path} |
| Download file | POST | `/api/connections/{id}/download` | Body: {remote_path, local_path} |
| Upload folder | POST | `/api/connections/{id}/upload-folder` | Body: {local_path, remote_path} |
| Compress | POST | `/api/connections/{id}/compress` | Body: {source_path, target_path} |
| Extract | POST | `/api/connections/{id}/extract` | Body: {file_path, target_dir} |
| Search files | GET | `/api/connections/{id}/search-files?path=&pattern=&max_results=` | URL-encoded params |
| Create file | POST | `/api/connections/{id}/create-file` | Body: {path} |
| Delete directory | POST | `/api/connections/{id}/delete-directory` | Body: {path} |
| List saved | GET | `/api/saved-connections` | Returns ConnectionRecord[] |
| Quick connect | POST | `/api/saved-connections/{id}/connect` | Returns connection id |

**Response format:** `{ success: boolean, data?: T, error?: string }`

## ANTI-PATTERNS

- **Don't** add tools without `iter_` prefix - naming collision risk
- **Don't** bypass `apiCall()` - always use typed wrapper
- **Don't** hardcode connection IDs - accept from caller
- **Don't** assume default port 22 - allow override in connect
- **Don't** forget URL encoding for path params in file ops
- **Don't** return raw Error objects - wrap in `ApiResponse` format
- **Don't** add long-polling tools - MCP tools should be synchronous
- **Don't** store state in MCP server - state lives in iTerminal HTTP API