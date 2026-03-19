#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            iterminal::commands::system::save_window_state,
            iterminal::commands::system::restore_window_state,
            iterminal::commands::api::is_api_server_running,
            iterminal::commands::api::stop_api_server,
            iterminal::commands::api::start_api_server_command,
            iterminal::commands::license::verify_license,
            iterminal::commands::license::get_license,
            iterminal::commands::license::is_feature_available,
            iterminal::commands::license::check_connection_limit,
            iterminal::commands::license::clear_license,
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
        ])
        .setup(|app| {
            // 在应用启动时初始化数据库
            if let Err(e) = iterminal::commands::db::init_database(app.handle().clone()) {
                eprintln!("Failed to initialize database: {}", e);
            }

            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.webview_windows().get("main") {
                            window.hide().unwrap();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.webview_windows().get("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
