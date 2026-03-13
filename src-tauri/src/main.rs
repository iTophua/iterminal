#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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
            iterminal::commands::sftp::list_directory,
            iterminal::commands::sftp::create_file,
            iterminal::commands::sftp::create_directory,
            iterminal::commands::sftp::rename_file,
            iterminal::commands::sftp::delete_file,
            iterminal::commands::sftp::delete_directory,
            iterminal::commands::sftp::chmod_file,
            iterminal::commands::sftp::upload_file,
            iterminal::commands::sftp::download_file,
            iterminal::commands::sftp::upload_folder,
            iterminal::commands::sftp::compress_file,
            iterminal::commands::sftp::open_folder,
            iterminal::commands::sftp::open_file_location,
            iterminal::commands::sftp::cancel_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
