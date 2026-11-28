//! 批量执行：在多台服务器上并发跑同一条命令，汇总结果。
//! "30 台机器看一眼磁盘"是运维高频场景，输入广播只解决"同时敲"，不解决"看结果"。

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::db;
use super::host_key::{self, HostKeyPolicy};
use super::ssh::{self, CommandResult, SSHConnection};

/// 临时建连（含跳板机、认证）最长等这么久
const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BatchExecResult {
    pub id: String,
    /// 连接名
    pub label: String,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    /// 命令超时被强制终止，output 含超时前已收到的输出
    pub timed_out: bool,
}

impl BatchExecResult {
    fn failed(id: String, label: String, error: String) -> Self {
        Self {
            id,
            label,
            success: false,
            output: String::new(),
            error: Some(error),
            timed_out: false,
        }
    }

    fn from_command(id: String, label: String, result: CommandResult) -> Self {
        Self {
            id,
            label,
            success: result.success,
            output: result.output,
            error: result.error,
            timed_out: result.timed_out,
        }
    }
}

/// 规划：已连接的直接排进执行队列，没连接的排进建连队列；重复的 id 只算一次。
/// 元组里带上输入中的位置，结果按用户选择的顺序返回。
fn plan(ids: &[String], connected: &HashSet<String>) -> (Vec<(usize, String)>, Vec<(usize, String)>) {
    let mut seen = HashSet::new();
    let mut ready = Vec::new();
    let mut pending = Vec::new();
    for (index, id) in ids.iter().enumerate() {
        if !seen.insert(id.as_str()) {
            continue;
        }
        if connected.contains(id) {
            ready.push((index, id.clone()));
        } else {
            pending.push((index, id.clone()));
        }
    }
    (ready, pending)
}

/// 批量执行（Tauri 命令与 HTTP API 共用）。
///
/// 已连接的会话直接执行；没连接的按保存的配置临时建连，跑完即断，不在界面上打开终端。
/// policy 决定临时建连时遇到没信任过的主机密钥怎么办。
pub async fn run(
    ids: &[String],
    command: &str,
    policy: HostKeyPolicy,
    app: Option<AppHandle>,
) -> Result<Vec<BatchExecResult>, String> {
    let connected: HashSet<String> = ssh::SESSIONS.read().await.keys().cloned().collect();
    let (mut items, pending) = plan(ids, &connected);
    let mut results: Vec<Option<BatchExecResult>> = vec![None; ids.len()];

    let records = db::get_connections()?;
    let label_of = |id: &str| {
        records
            .iter()
            .find(|record| record.id == id)
            .map(|record| record.name.clone())
            .unwrap_or_else(|| id.to_string())
    };

    // 临时建连：并发进行，30 台机器顺序握手要等一分钟
    let mut opening = tokio::task::JoinSet::new();
    for (index, id) in pending {
        let Some(record) = records.iter().find(|record| record.id == id) else {
            results[index] = Some(BatchExecResult::failed(
                id.clone(),
                id,
                "连接配置不存在".to_string(),
            ));
            continue;
        };
        let connection = SSHConnection::from_record(record);
        let label = record.name.clone();
        let app = app.clone();
        opening.spawn(async move {
            let attempt = tokio::time::timeout(
                CONNECT_TIMEOUT,
                ssh::connect_ssh_with(id.clone(), connection, policy, app),
            )
            .await;
            let error = match attempt {
                Ok(Ok(true)) => None,
                Ok(Ok(false)) => Some("未能建立连接".to_string()),
                Ok(Err(e)) => Some(host_key::describe(&e).unwrap_or(e)),
                Err(_) => Some("连接超时".to_string()),
            };
            (index, id, label, error)
        });
    }

    let mut opened: Vec<String> = Vec::new();
    while let Some(joined) = opening.join_next().await {
        // 任务 panic 时拿不到它对应哪条连接，只能单列一行
        let (index, id, label, error) = match joined {
            Ok(outcome) => outcome,
            Err(e) => {
                results.push(Some(BatchExecResult::failed(
                    String::new(),
                    "未知连接".to_string(),
                    e.to_string(),
                )));
                continue;
            }
        };
        match error {
            None => {
                opened.push(id.clone());
                items.push((index, id));
            }
            Some(error) => results[index] = Some(BatchExecResult::failed(id, label, error)),
        }
    }

    // 执行：每条连接一个任务，全部结束后汇总
    let mut executing = tokio::task::JoinSet::new();
    for (index, id) in items {
        let command = command.to_string();
        let label = label_of(&id);
        executing.spawn(async move {
            let outcome = ssh::execute_command(id.clone(), command).await;
            (index, id, label, outcome)
        });
    }
    while let Some(joined) = executing.join_next().await {
        match joined {
            Ok((index, id, label, Ok(result))) => {
                results[index] = Some(BatchExecResult::from_command(id, label, result));
            }
            Ok((index, id, label, Err(error))) => {
                results[index] = Some(BatchExecResult::failed(id, label, error));
            }
            Err(e) => results.push(Some(BatchExecResult::failed(
                String::new(),
                "未知连接".to_string(),
                e.to_string(),
            ))),
        }
    }

    for id in &opened {
        ssh::close_session(id).await;
    }

    Ok(results.into_iter().flatten().collect())
}

#[tauri::command]
pub async fn batch_execute_command(
    ids: Vec<String>,
    command: String,
    app: AppHandle,
) -> Result<Vec<BatchExecResult>, String> {
    run(&ids, &command, HostKeyPolicy::RequireTrusted, Some(app)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_splits_connected_from_pending_and_dedupes() {
        let ids = vec!["a".to_string(), "b".to_string(), "a".to_string(), "c".to_string()];
        let connected: HashSet<String> = ["b".to_string()].into_iter().collect();
        let (ready, pending) = plan(&ids, &connected);
        assert_eq!(ready, vec![(1, "b".to_string())]);
        assert_eq!(pending, vec![(0, "a".to_string()), (3, "c".to_string())]);
    }

    #[test]
    fn results_carry_command_outcome() {
        let ok = BatchExecResult::from_command(
            "id".into(),
            "web".into(),
            CommandResult {
                success: true,
                output: "ok".into(),
                error: None,
                timed_out: false,
                output_truncated: false,
            },
        );
        assert!(ok.success);
        assert_eq!(ok.label, "web");

        let failed = BatchExecResult::failed("id".into(), "web".into(), "连接超时".into());
        assert!(!failed.success);
        assert_eq!(failed.error.as_deref(), Some("连接超时"));
    }

}
