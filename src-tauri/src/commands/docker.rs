//! Docker 管理模块（复用 SSH 会话执行 docker 命令）
//!
//! 通过在已连接的 SSH 会话上执行 `docker ps`/`docker images`/`docker logs` 等命令实现。
//! 免费版功能（docker_mgmt 已下沉到 Free）。
//!
//! 前提：远程服务器已安装 docker，且当前 SSH 用户有 docker 权限（在 docker 组或 root）。

use serde::{Deserialize, Serialize};

use super::ssh::execute_command;

// ============ 数据结构 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    /// 如 "Up 2 hours" / "Exited (0) 5 minutes ago"
    pub status: String,
    /// running / exited / paused / created / restarting ...
    pub state: String,
    /// 端口映射，如 "0.0.0.0:8080->80/tcp"；可能为空
    pub ports: Option<String>,
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    /// 短 id（去 sha256: 前缀）
    pub id: String,
    /// 仓库名，如 "nginx"
    pub repository: String,
    /// 标签，如 "latest"；可能为 "<none>"
    pub tag: String,
    /// 如 "142MB"
    pub size: String,
    pub created: Option<String>,
}

// ============ 容器 ============

/// 列出容器。
/// `all=false` 仅运行中，`true` 含已停止。
#[tauri::command]
pub async fn list_containers(connection_id: String, all: bool) -> Result<Vec<ContainerInfo>, String> {
    let flag = if all { "--all" } else { "" };
    // --format '{{json .}}' 每行一个 JSON
    let cmd = format!("docker ps --format '{{{{json .}}}}' {}", flag);
    let result = execute_command(connection_id, cmd).await?;
    if !result.success {
        return Err(format_docker_error(&result));
    }
    Ok(parse_container_lines(&result.output))
}

/// 解析 `docker ps --format '{{json .}}'` 的输出（每行一个 JSON）。
fn parse_container_lines(output: &str) -> Vec<ContainerInfo> {
    let mut containers = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        containers.push(ContainerInfo {
            id: v["ID"].as_str().unwrap_or("").to_string(),
            name: v["Names"].as_str().unwrap_or("").to_string(),
            image: v["Image"].as_str().unwrap_or("").to_string(),
            status: v["Status"].as_str().unwrap_or("").to_string(),
            state: v["State"].as_str().unwrap_or("").to_string(),
            ports: {
                let p = v["Ports"].as_str().unwrap_or("");
                if p.is_empty() {
                    None
                } else {
                    Some(p.to_string())
                }
            },
            created: {
                let c = v["CreatedAt"].as_str();
                c.map(|s| s.to_string())
            },
        });
    }
    containers
}

/// 容器操作：start / stop / restart / kill / remove
#[tauri::command]
pub async fn container_action(
    connection_id: String,
    container_id: String,
    action: String,
) -> Result<bool, String> {
    let act = action.trim().to_lowercase();
    let docker_sub = match act.as_str() {
        "start" => "start",
        "stop" => "stop",
        "restart" => "restart",
        "kill" => "kill",
        "remove" | "rm" => "rm",
        other => return Err(format!("不支持的操作: {}", other)),
    };
    let cmd = format!("docker {} {}", docker_sub, container_id);
    let result = execute_command(connection_id, cmd).await?;
    if !result.success {
        return Err(format_docker_error(&result));
    }
    Ok(true)
}

/// 容器日志（一次性，非 -f 流式）。
/// `tail` 控制尾部行数，默认 500。
#[tauri::command]
pub async fn container_logs(
    connection_id: String,
    container_id: String,
    tail: Option<u32>,
) -> Result<String, String> {
    let n = tail.unwrap_or(500);
    let cmd = format!("docker logs --tail {} {}", n, container_id);
    let result = execute_command(connection_id, cmd).await?;
    // docker logs 输出走 stdout+stderr，合并返回（保留顺序近似）
    // 注意：success 判断对 logs 意义不大（容器退出码非0也会让 logs 返回非0），
    // 所以这里即使 success=false 也返回 output，仅当完全无输出且报错时才抛错
    if !result.output.is_empty() {
        Ok(result.output)
    } else if let Some(err) = result.error {
        if !result.success {
            Err(err)
        } else {
            Ok(String::new())
        }
    } else {
        Ok(String::new())
    }
}

// ============ 镜像 ============

/// 列出镜像
#[tauri::command]
pub async fn list_images(connection_id: String) -> Result<Vec<ImageInfo>, String> {
    let cmd = "docker images --format '{{json .}}'";
    let result = execute_command(connection_id, cmd.into()).await?;
    if !result.success {
        return Err(format_docker_error(&result));
    }
    Ok(parse_image_lines(&result.output))
}

/// 解析 `docker images --format '{{json .}}'` 输出。
fn parse_image_lines(output: &str) -> Vec<ImageInfo> {
    let mut images = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        images.push(ImageInfo {
            id: v["ID"].as_str().unwrap_or("").to_string(),
            repository: v["Repository"].as_str().unwrap_or("").to_string(),
            tag: v["Tag"].as_str().unwrap_or("").to_string(),
            size: v["Size"].as_str().unwrap_or("").to_string(),
            created: {
                let c = v["CreatedAt"].as_str();
                c.map(|s| s.to_string())
            },
        });
    }
    images
}

/// 删除镜像
#[tauri::command]
pub async fn remove_image(connection_id: String, image_id: String) -> Result<bool, String> {
    let cmd = format!("docker rmi {}", image_id);
    let result = execute_command(connection_id, cmd).await?;
    if !result.success {
        return Err(format_docker_error(&result));
    }
    Ok(true)
}

// ============ 工具 ============

/// 把失败的 docker 命令结果格式化为友好错误信息
fn format_docker_error(result: &crate::commands::ssh::CommandResult) -> String {
    let stderr = result.error.as_deref().unwrap_or("").trim();
    if stderr.contains("command not found") || stderr.contains("not found") {
        return "远程服务器未安装 Docker，请确认已安装 docker 命令".into();
    }
    if stderr.contains("permission denied") || stderr.contains("Got permission denied") {
        return "当前用户无 Docker 权限，请将用户加入 docker 组或使用 sudo".into();
    }
    if stderr.contains("Cannot connect to the Docker daemon") {
        return "Docker daemon 未运行，请启动 docker 服务".into();
    }
    if !stderr.is_empty() {
        stderr.to_string()
    } else {
        format!("Docker 命令执行失败")
    }
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_container_lines_basic() {
        // docker ps --format '{{json .}}' 的典型行
        let output = r#"{"Command":"nginx","CreatedAt":"2026-07-08 10:00:00 +0000 UTC","ID":"a1b2c3d4","Image":"nginx:latest","Labels":"","LocalVolumes":"0","Mounts":"","Names":"web","Networks":"bridge","Ports":"0.0.0.0:8080->80/tcp","RunningFor":"2 hours ago","Size":"0B","Status":"Up 2 hours","State":"running"}
{"Command":"sleep","CreatedAt":"2026-07-08 09:00:00 +0000 UTC","ID":"e5f6g7h8","Image":"alpine","Labels":"","LocalVolumes":"0","Mounts":"","Names":"worker","Networks":"bridge","Ports":"","RunningFor":"3 hours ago","Size":"0B","Status":"Exited (0) 5 minutes ago","State":"exited"}"#;
        let containers = parse_container_lines(output);
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].id, "a1b2c3d4");
        assert_eq!(containers[0].name, "web");
        assert_eq!(containers[0].image, "nginx:latest");
        assert_eq!(containers[0].state, "running");
        assert_eq!(containers[0].ports.as_deref(), Some("0.0.0.0:8080->80/tcp"));
        // 第二个无端口映射
        assert_eq!(containers[1].ports, None);
        assert_eq!(containers[1].state, "exited");
    }

    #[test]
    fn test_parse_container_lines_empty() {
        assert!(parse_container_lines("").is_empty());
        assert!(parse_container_lines("   \n  \n").is_empty());
    }

    #[test]
    fn test_parse_container_lines_invalid_json_skipped() {
        let output = "not json\n{\"ID\":\"ok\",\"Names\":\"x\",\"Image\":\"y\",\"Status\":\"Up\",\"State\":\"running\",\"Ports\":\"\"}\nalso not json";
        let containers = parse_container_lines(output);
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].id, "ok");
    }

    #[test]
    fn test_parse_image_lines_basic() {
        let output = r#"{"Containers":"N/A","CreatedAt":"2026-07-01 12:00 +0000","CreatedSince":"1 week ago","Digest":"<none>","ID":"sha256:abc123","Repository":"nginx","SharedSize":"N/A","Size":"142MB","Tag":"latest","UniqueSize":"N/A","VirtualSize":"142MB"}
{"Containers":"N/A","CreatedAt":"2026-06-01 12:00 +0000","CreatedSince":"5 weeks ago","Digest":"<none>","ID":"sha256:def456","Repository":"alpine","SharedSize":"N/A","Size":"7.8MB","Tag":"3.18","UniqueSize":"N/A","VirtualSize":"7.8MB"}"#;
        let images = parse_image_lines(output);
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].repository, "nginx");
        assert_eq!(images[0].tag, "latest");
        assert_eq!(images[0].size, "142MB");
        assert_eq!(images[0].id, "sha256:abc123");
    }

    #[test]
    fn test_parse_image_lines_none_tag() {
        let output = r#"{"ID":"sha256:x","Repository":"<none>","Tag":"<none>","Size":"100MB","CreatedAt":"x"}"#;
        let images = parse_image_lines(output);
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].tag, "<none>");
    }

    #[test]
    fn test_parse_image_lines_empty() {
        assert!(parse_image_lines("").is_empty());
    }
}
