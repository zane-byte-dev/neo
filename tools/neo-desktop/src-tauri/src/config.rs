use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub vault_path: String,
    pub gemini_api_key: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vault_path: String::new(),
            gemini_api_key: String::new(),
        }
    }
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
}

fn get_config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("com.neo.desktop");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path.push("config.json");
    path
}

pub fn load_config_sync() -> AppConfig {
    let path = get_config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str(&content) {
            return config;
        }
    }
    AppConfig::default()
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    vault_path: String,
    gemini_api_key: String,
) -> Result<(), String> {
    let mut config = state.config.lock().await;
    config.vault_path = vault_path.clone();
    config.gemini_api_key = gemini_api_key.clone();

    // Save to disk
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;

    Ok(())
}
