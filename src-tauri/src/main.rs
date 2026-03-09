#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            iterminal::commands::ssh::connect_ssh,
            iterminal::commands::ssh::disconnect_ssh,
            iterminal::commands::ssh::execute_command,
            iterminal::commands::ssh::test_connection,
            iterminal::commands::ssh::get_shell,
            iterminal::commands::ssh::write_shell,
            iterminal::commands::ssh::read_shell,
            iterminal::commands::ssh::close_shell,
            iterminal::commands::sftp::list_directory,
            iterminal::commands::sftp::upload_file,
            iterminal::commands::sftp::download_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}