mod config;
mod file_ops;
mod chat;
mod cli;
mod genai;
mod tg_bot;

use config::{AppState, load_config_sync};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if cli::handle_cli_args() {
        std::process::exit(0);
    }

    let initial_config = load_config_sync();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            config: Mutex::new(initial_config),
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config,
            file_ops::read_markdown_file,
            file_ops::write_markdown_file,
            file_ops::search_files,
            file_ops::append_diary_entry,
            file_ops::list_directory,
            file_ops::create_directory,
            file_ops::delete_path,
            file_ops::move_path,
            file_ops::copy_path,
            chat::load_chat_history,
            chat::save_chat_history,
            chat::clear_chat_history,
            genai::run_skill,
            genai::chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
