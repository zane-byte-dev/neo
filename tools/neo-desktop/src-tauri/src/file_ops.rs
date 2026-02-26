use crate::config::AppState;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize)]
pub struct SearchResult {
    pub matches: Vec<String>,
    pub total_found: usize,
}

#[tauri::command]
pub async fn read_markdown_file(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path is not configured".into());
    }

    let target_path = Path::new(vault_path).join(&relative_path);

    // Basic security check (prevent directory traversal)
    if !target_path.starts_with(vault_path) {
        return Err("Security violation: Path traversal prevented".into());
    }

    fs::read_to_string(&target_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_files(
    state: State<'_, AppState>,
    query: String,
) -> Result<SearchResult, String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path is not configured".into());
    }

    if query.trim().is_empty() {
        return Err("Search query cannot be empty".into());
    }

    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    let vault_dir = Path::new(vault_path);

    // Simple recursive walk (synchronous is fine for local vault sizes, or could use walkdir crate)
    fn walk_dir(dir: &Path, query: &str, vault_root: &Path, results: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy();

                if path.is_dir() {
                    // Exclude common dirs
                    if name != ".git" && name != "node_modules" && name != ".obsidian" && !name.starts_with('.') {
                        walk_dir(&path, query, vault_root, results);
                    }
                } else if path.is_file() && name.ends_with(".md") {
                    if name.to_lowercase().contains(query) {
                        if let Ok(rel_path) = path.strip_prefix(vault_root) {
                            results.push(rel_path.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
    }

    walk_dir(vault_dir, &query_lower, vault_dir, &mut results);

    let total = results.len();
    results.truncate(20); // Limit to top 20 like typescript version

    Ok(SearchResult {
        matches: results,
        total_found: total,
    })
}

#[tauri::command]
pub async fn append_diary_entry(
    state: State<'_, AppState>,
    section: String,
    content: String,
    date_override: Option<String>,
) -> Result<String, String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path is not configured".into());
    }

    let target_date = date_override.unwrap_or_else(|| {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    });

    // Create history/YYYY/MM dir if needed
    let parts: Vec<&str> = target_date.split('-').collect();
    if parts.len() != 3 {
        return Err("Invalid date format, expect YYYY-MM-DD".into());
    }
    
    let year = parts[0];
    let month = parts[1];
    
    let history_dir = Path::new(vault_path).join("history").join(year).join(month);
    let _ = fs::create_dir_all(&history_dir);
    
    let target_path = history_dir.join(format!("{}.md", target_date));

    let mut file_content = fs::read_to_string(&target_path).unwrap_or_else(|_| {
        format!("# 📝 {}\n\n## 🟢 流水\n\n## 🧠 深度思考\n\n## 🍎 知识增量\n", target_date)
    });

    let target_header = if section.contains("流水") {
        "## 🟢 流水"
    } else if section.contains("思考") {
        "## 🧠 深度思考"
    } else {
        return Err("Invalid section. Must contain '流水' or '深度思考'".into());
    };

    if let Some(idx) = file_content.find(target_header) {
        let injection_point = idx + target_header.len() + 1; // +1 for newline
        
        let formatted_content = if content.trim().starts_with('-') {
            format!("{}\n", content.trim_end())
        } else {
            format!("- {}\n", content.trim())
        };

        file_content.insert_str(injection_point, &format!("{}\n", formatted_content));
        
        fs::write(&target_path, file_content).map_err(|e| format!("Failed to write: {}", e))?;
        Ok(format!("Successfully appended to {}.md under {}", target_date, section))
    } else {
        Err(format!("Could not find section '{}' in today's diary layout.", section))
    }
}

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String, // relative to vault root
    pub is_dir: bool,
}

#[tauri::command]
pub async fn list_directory(
    state: State<'_, AppState>,
    relative_path: Option<String>,
) -> Result<Vec<FileNode>, String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path is not configured".into());
    }

    let target_dir = if let Some(p) = &relative_path {
        Path::new(vault_path).join(p)
    } else {
        PathBuf::from(vault_path)
    };

    if !target_dir.exists() || !target_dir.is_dir() {
        return Err("Target is not a valid directory".into());
    }

    if !target_dir.starts_with(vault_path) {
        return Err("Security violation: Path traversal prevented".into());
    }

    let mut nodes = Vec::new();

    if let Ok(entries) = fs::read_dir(&target_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            
            // Exclude hidden files / common dev folders
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }

            let is_dir = path.is_dir();
            
            // Only include directories or markdown files
            if is_dir || name.ends_with(".md") {
                let rel_path = path.strip_prefix(vault_path).unwrap_or(&path).to_string_lossy().to_string();
                nodes.push(FileNode {
                    name,
                    path: rel_path.replace("\\", "/"),
                    is_dir,
                });
            }
        }
    }

    // Sort: directories first, then alphabetical
    nodes.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(nodes)
}

#[tauri::command]
pub async fn write_markdown_file(
    state: State<'_, AppState>,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;

    if vault_path.is_empty() {
        return Err("Vault path is not configured".into());
    }

    let target_path = Path::new(vault_path).join(&relative_path);

    if !target_path.starts_with(vault_path) {
        return Err("Security violation: Path traversal prevented".into());
    }

    // Ensure the parent directory exists
    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
        }
    }

    fs::write(&target_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn create_directory(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;
    if vault_path.is_empty() { return Err("Vault path is not configured".into()); }
    let target_path = Path::new(vault_path).join(&relative_path);
    if !target_path.starts_with(vault_path) { return Err("Security violation".into()); }
    fs::create_dir_all(&target_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_path(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;
    if vault_path.is_empty() { return Err("Vault path is not configured".into()); }
    let target_path = Path::new(vault_path).join(&relative_path);
    if !target_path.starts_with(vault_path) { return Err("Security violation".into()); }
    if target_path.is_dir() {
        fs::remove_dir_all(&target_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&target_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn move_path(
    state: State<'_, AppState>,
    from_path: String,
    to_path: String,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;
    if vault_path.is_empty() { return Err("Vault path is not configured".into()); }
    let source = Path::new(vault_path).join(&from_path);
    let target = Path::new(vault_path).join(&to_path);
    if !source.starts_with(vault_path) || !target.starts_with(vault_path) { return Err("Security violation".into()); }
    
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::rename(&source, &target).map_err(|e| e.to_string())
}

fn copy_recursively(source: impl AsRef<Path>, destination: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(&destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.as_ref().join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_recursively(entry.path(), target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_path(
    state: State<'_, AppState>,
    from_path: String,
    to_path: String,
) -> Result<(), String> {
    let config = state.config.lock().await;
    let vault_path = &config.vault_path;
    if vault_path.is_empty() { return Err("Vault path is not configured".into()); }
    let source = Path::new(vault_path).join(&from_path);
    let target = Path::new(vault_path).join(&to_path);
    if !source.starts_with(vault_path) || !target.starts_with(vault_path) { return Err("Security violation".into()); }
    
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    if source.is_dir() {
        copy_recursively(&source, &target).map_err(|e| e.to_string())
    } else {
        fs::copy(&source, &target).map_err(|e| e.to_string()).map(|_| ())
    }
}
