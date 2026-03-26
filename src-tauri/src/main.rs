#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            iterminal::commands::ssh::connect_ssh,
            iterminal::commands::ssh::disconnect_ssh,
            iterminal::commands::ssh::execute_command,
            iterminal::commands::ssh::test_connection,
            iterminal::commands::ssh::get_shell,
            iterminal::commands::ssh::start_shell_reader,
            iterminal::commands::ssh::write_shell,
            iterminal::commands::ssh::close_shell,
            iterminal::commands::ssh::resize_shell,
            iterminal::commands::ssh::check_port_reachable,
            iterminal::commands::ssh::get_system_monitor,
            iterminal::commands::ssh::get_network_stats,
            iterminal::commands::ssh::list_processes,
            iterminal::commands::ssh::kill_process,
            iterminal::commands::sftp::list_directory,
            iterminal::commands::sftp::create_file,
            iterminal::commands::sftp::create_directory,
            iterminal::commands::sftp::rename_file,
            iterminal::commands::sftp::delete_file,
            iterminal::commands::sftp::delete_directory,
            iterminal::commands::sftp::chmod_file,
            iterminal::commands::sftp::file_exists,
            iterminal::commands::sftp::read_file_content,
            iterminal::commands::sftp::write_file_content,
            iterminal::commands::sftp::upload_file,
            iterminal::commands::sftp::download_file,
            iterminal::commands::sftp::upload_folder,
            iterminal::commands::sftp::compress_file,
            iterminal::commands::sftp::open_folder,
            iterminal::commands::sftp::open_file_location,
            iterminal::commands::sftp::cancel_transfer,
            iterminal::commands::sftp::pause_transfer,
            iterminal::commands::sftp::resume_transfer,
            iterminal::commands::sftp::is_directory,
            iterminal::commands::sftp::is_local_directory,
            iterminal::commands::sftp::search_files,
            iterminal::commands::sftp::extract_file,
            iterminal::commands::system::get_system_fonts,
            iterminal::commands::system::get_monospace_fonts,
            iterminal::commands::api::is_api_server_running,
            iterminal::commands::api::stop_api_server,
            iterminal::commands::api::start_api_server_command,
            iterminal::commands::license::verify_license,
            iterminal::commands::license::get_license,
            iterminal::commands::license::is_feature_available,
            iterminal::commands::license::check_connection_limit,
            iterminal::commands::license::clear_license,
            iterminal::commands::license::set_license_bypass,
            iterminal::commands::license::is_license_bypassed,
            iterminal::commands::db::init_database,
            iterminal::commands::db::get_connections,
            iterminal::commands::db::save_connection,
            iterminal::commands::db::delete_connection,
            iterminal::commands::db::get_setting,
            iterminal::commands::db::save_setting,
            iterminal::commands::db::export_connections,
            iterminal::commands::db::import_connections,
            iterminal::commands::db::export_all_data,
            iterminal::commands::db::import_all_data,
            iterminal::commands::db::migrate_from_localstorage,
            iterminal::commands::db::record_connection_history,
            iterminal::commands::db::get_recent_connections,
            iterminal::commands::db::update_connection_order,
            iterminal::commands::db::get_command_history,
            iterminal::commands::db::save_command,
            iterminal::commands::db::clear_command_history,
            iterminal::commands::db::cleanup_command_history,
            iterminal::commands::window::create_terminal_window,
            iterminal::commands::window::close_terminal_window,
            iterminal::commands::window::get_terminal_window_data,
        ])
        .setup(|app| {
            if let Err(e) = iterminal::commands::db::init_database(app.handle().clone()) {
                eprintln!("Failed to initialize database: {}", e);
            }

            let new_conn =
                MenuItem::with_id(app, "new_connection", "新建连接", true, Some("CmdOrCtrl+N"))?;
            let import_conn =
                MenuItem::with_id(app, "import_connections", "导入连接...", true, None::<&str>)?;
            let export_conn =
                MenuItem::with_id(app, "export_connections", "导出连接...", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "设置...", true, Some("CmdOrCtrl+,"))?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, Some("CmdOrCtrl+Q"))?;

            let file_menu = Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &new_conn,
                    &PredefinedMenuItem::separator(app)?,
                    &import_conn,
                    &export_conn,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;

            let copy_item = MenuItem::with_id(app, "copy", "复制", true, Some("CmdOrCtrl+C"))?;
            let paste_item = MenuItem::with_id(app, "paste", "粘贴", true, Some("CmdOrCtrl+V"))?;
            let select_all =
                MenuItem::with_id(app, "select_all", "全选", true, Some("CmdOrCtrl+A"))?;

            let edit_menu =
                Submenu::with_items(app, "编辑", true, &[&copy_item, &paste_item, &select_all])?;

            let fullscreen =
                MenuItem::with_id(app, "fullscreen", "全屏", true, Some("CmdOrCtrl+Shift+F"))?;

            let view_menu = Submenu::with_items(app, "视图", true, &[&fullscreen])?;

            let about = MenuItem::with_id(app, "about", "关于 iTerminal", true, None::<&str>)?;
            let github = MenuItem::with_id(app, "github", "GitHub 仓库", true, None::<&str>)?;
            let report_issue =
                MenuItem::with_id(app, "report_issue", "问题反馈", true, None::<&str>)?;

            let help_menu = Submenu::with_items(
                app,
                "帮助",
                true,
                &[
                    &about,
                    &PredefinedMenuItem::separator(app)?,
                    &github,
                    &report_issue,
                ],
            )?;

            let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &help_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let event_id = event.id.as_ref();
                match event_id {
                    "new_connection" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "new-connection");
                        }
                    }
                    "import_connections" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "import-connections");
                        }
                    }
                    "export_connections" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "export-connections");
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "open-settings");
                        }
                    }
                    "copy" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "copy");
                        }
                    }
                    "paste" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "paste");
                        }
                    }
                    "select_all" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "select-all");
                        }
                    }
                    "fullscreen" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "toggle-fullscreen");
                        }
                    }
                    "about" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            let _ = window.emit("menu-action", "show-about");
                        }
                    }
                    "github" => {
                        let _ = app
                            .opener()
                            .open_url("https://github.com/iTophua/iterminal", None::<&str>);
                    }
                    "report_issue" => {
                        let _ = app
                            .opener()
                            .open_url("https://github.com/iTophua/iterminal/issues", None::<&str>);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
