use crate::config::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::State;

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatHistory {
    pub messages: Vec<ChatMessage>,
}

#[tauri::command]
pub async fn load_chat_history(state: State<'_, AppState>) -> Result<ChatHistory, String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Ok(ChatHistory { messages: vec![] });
    }

    let history_path = Path::new(vault_path).join(".neo_chat_history.json");
    if let Ok(content) = fs::read_to_string(&history_path) {
        if let Ok(history) = serde_json::from_str(&content) {
            return Ok(history);
        }
    }

    Ok(ChatHistory { messages: vec![] })
}

#[tauri::command]
pub async fn save_chat_history(
    state: State<'_, AppState>,
    history: ChatHistory,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path not configured".into());
    }

    let history_path = Path::new(vault_path).join(".neo_chat_history.json");
    let content = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(history_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn clear_chat_history(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path not configured".into());
    }

    let history_path = Path::new(vault_path).join(".neo_chat_history.json");
    if history_path.exists() {
        fs::remove_file(history_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// In a real robust implementation, we'd port the full gemini-tools logic to Rust here
// or call the Gemini REST API via reqwest.
// For the MVP, we will do the HTTP call to Gemini in the frontend (React) using the API key,
// and React will call our Rust `read_markdown_file`, `search_files`, `append_diary_entry`
// commands when the model requests a tool call!
// This keeps the Rust layer strictly as a secure Local API for the frontend.
