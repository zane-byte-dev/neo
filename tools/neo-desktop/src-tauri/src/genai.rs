use std::env;
use std::fs;
use std::path::PathBuf;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::process::Command;
use crate::config::load_config_sync;

pub async fn run_skill(skill_name: &str, args: Vec<String>) -> Result<String, String> {
    let config = load_config_sync();
    let api_key = env::var("GEMINI_API_KEY").or_else(|_| Ok::<String, String>(config.gemini_api_key.clone())).unwrap_or_default();
    
    if api_key.is_empty() {
        return Err("GEMINI_API_KEY not found in environment or config".to_string());
    }

    let work_dir = config.vault_path.clone();
    if work_dir.is_empty() {
        return Err("work_dir not found in config".to_string());
    }
    
    let base_path = PathBuf::from(&work_dir);
    let skill_path = base_path.join("system").join("skill").join(format!("{}.md", skill_name));

    if !skill_path.exists() {
        return Err(format!("❌ 技能文件未找到: {:?}\n请检查 {} 是否存在于 system/skill/ 目录下。", skill_path, skill_name));
    }

    let skill_content = fs::read_to_string(&skill_path).map_err(|e| e.to_string())?;
    let gemini_md_path = base_path.join("system").join("GEMINI.md");
    let system_context = fs::read_to_string(gemini_md_path).unwrap_or_default();

    let mut final_instruction = String::new();
    if !system_context.is_empty() {
        final_instruction.push_str(&format!("[Master System Alignment]\n{}\n\n", system_context));
    }
    
    final_instruction.push_str(&format!("[Skill Profile: {}]\nYou are an autonomous agent executing this specific skill. Read the skill instructions below carefully and strictly follow the execution steps.\n{}\n\n", skill_name, skill_content));
    final_instruction.push_str("[Critical System Rules]\n- You MUST respond strictly in CHINESE (简体中文).\n- NEVER output repetitive reasoning logs or think out loud formatting.\n- Be direct, concise, and professional without generic AI phrases.\n");

    let prompt = format!("Please execute the skill **{}**.\n\nAdditional user input/arguments: {}", skill_name, args.join(" "));

    let model_name = "gemini-2.5-flash"; 
    
    let client = Client::new();
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", model_name, api_key);

    // Initial tool call definitions
    let tools = json!([{
        "functionDeclarations": [
            {
                "name": "search_content",
                "description": "Search for specific text content across all markdown files in the workspace (full-text search). Use this to find knowledge base articles or past notes containing specific concepts.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "query": {
                            "type": "STRING",
                            "description": "The text snippet, concept, or keyword to search for inside files."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "read_markdown_file",
                "description": "Read the content of a markdown file. Provide a relative path like 'history/2026-02-24.md'.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "relativePath": {
                            "type": "STRING",
                            "description": "Relative path to the markdown file."
                        }
                    },
                    "required": ["relativePath"]
                }
            }
        ]
    }]);

    // Construct the initial request
    let mut history = vec![
        json!({"role": "user", "parts": [{"text": prompt}]})
    ];
    
    // We will simulate a simplistic multi-turn loop
    let mut max_turns = 10;
    let mut final_text = String::new();
    let mut fn_reports: Vec<String> = Vec::new();

    while max_turns > 0 {
        let request_body = json!({
            "systemInstruction": {
                "role": "system",
                "parts": [{"text": final_instruction}]
            },
            "contents": history,
            "tools": tools
        });

        let res = client.post(&url)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("API Request failed: {}", err_text));
        }

        let res_json: Value = res.json().await.map_err(|e| e.to_string())?;
        
        // Extract the response content to add to history
        if let Some(candidates) = res_json.get("candidates").and_then(|c| c.as_array()) {
            if let Some(first_candidate) = candidates.first() {
                if let Some(content) = first_candidate.get("content") {
                    let mut is_function_call = false;
                    let parts = content.get("parts").and_then(|p| p.as_array()).unwrap_or(&vec![]).clone(); // removed mut
                    
                    if let Some(first_part) = parts.first() {
                        if let Some(function_call) = first_part.get("functionCall") {
                            is_function_call = true;
                            let name = function_call.get("name").and_then(|n| n.as_str()).unwrap_or_default();
                            let empty_args = json!({});
                            let args = function_call.get("args").unwrap_or(&empty_args);
                            
                            println!("[Gemini SDK] 🛠️  Skill requested tool call: {}", name);
                            
                            // Let's add the model's response to history to fulfill multi-turn requirements
                            history.push(json!({
                                "role": "model",
                                "parts": parts
                            }));

                            // Execute local tool
                            let (api_response, success) = execute_tool(name, args, &base_path).await;
                            
                            if success {
                                fn_reports.push(format!("✅ 执行动作: [{}] 成功。", name));
                            } else {
                                fn_reports.push(format!("❌ 执行动作: [{}] 失败。", name));
                            }

                            // Add the function response back to history as user role with functionResponse
                            history.push(json!({
                                "role": "user",
                                "parts": [{
                                    "functionResponse": {
                                        "name": name,
                                        "response": api_response
                                    }
                                }]
                            }));
                            
                            max_turns -= 1;
                            continue;
                        }
                    }
                    
                    if !is_function_call {
                        // Just a text response, we are done
                        if let Some(first_part) = parts.first() {
                            if let Some(text) = first_part.get("text").and_then(|t| t.as_str()) {
                                final_text = text.to_string();
                            }
                        }
                        break;
                    }
                }
            }
        } else {
            return Err("No candidates returned".to_string());
        }
        
        max_turns -= 1;
    }

    if fn_reports.is_empty() {
        Ok(final_text)
    } else {
        Ok(format!("> _*系统通知*_\n> {}\n\n{}", fn_reports.join("\n> "), final_text))
    }
}

async fn execute_tool(name: &str, args: &Value, base_path: &PathBuf) -> (Value, bool) {
    match name {
        "search_content" => {
            if let Some(query) = args.get("query").and_then(|q| q.as_str()) {
                let exclude_dirs = [".git", "node_modules", "dist", ".obsidian"];
                let mut grep_args = vec!["-rin".to_string()];
                for dir in exclude_dirs.iter() {
                    grep_args.push(format!("--exclude-dir={}", dir));
                }
                grep_args.push("--include=*.md".to_string());
                grep_args.push(query.to_string());
                grep_args.push(base_path.to_string_lossy().to_string());

                match Command::new("grep").args(&grep_args).output().await {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let mut lines: Vec<&str> = stdout.lines().collect();
                        let total = lines.len();
                        lines.truncate(30);
                        
                        let base_str = format!("{}/", base_path.to_string_lossy());
                        let formatted: Vec<String> = lines.iter().map(|l| l.replace(&base_str, "")).collect();

                        if total == 0 {
                            (json!({"matches": [], "message": format!("No content found matching '{}'", query)}), true)
                        } else {
                            (json!({
                                "matches": formatted,
                                "totalFound": total,
                                "note": if total > 30 { "Results truncated to top 30 matches. Please use read_markdown_file on specific files for more details." } else { "" }
                            }), true)
                        }
                    },
                    Err(e) => (json!({"error": format!("grep command failed: {}", e)}), false)
                }
            } else {
                (json!({"error": "Missing 'query' argument"}), false)
            }
        },
        "read_markdown_file" => {
            if let Some(rel_path) = args.get("relativePath").and_then(|p| p.as_str()) {
                let safe_path = rel_path.replace("..", "");
                let target = base_path.join(safe_path);
                match fs::read_to_string(target) {
                    Ok(content) => (json!({"content": content}), true),
                    Err(e) => (json!({"error": format!("Failed to read file: {}", e)}), false)
                }
            } else {
                (json!({"error": "Missing 'relativePath' argument"}), false)
            }
        },
        _ => (json!({"error": format!("Tool '{}' not implemented in Rust client yet.", name)}), false)
    }
}
