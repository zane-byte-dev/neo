import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("memory-server", version="1.0.0")

def get_project_dir(provided_dir: str | None = None) -> str:
    return provided_dir or os.environ.get("GEMINI_PROJECT_DIR") or os.getcwd()

def extract_grammar_audits(content: str) -> list[dict[str, str]]:
    audits = []
    # Regex matching: Grammar Audit: "**original**" -> "**corrected**" (pattern)
    regex = re.compile(r'Grammar Audit: "\*\*?(.+?)\*\*?" -> "\*\*?(.+?)\*\*?"\s*(?:\((.+?)\))?')
    for match in regex.finditer(content):
        original = match.group(1).strip()
        corrected = match.group(2).strip()
        pattern = match.group(3).strip() if match.group(3) else "General Correction"
        audits.append({
            "original": original,
            "corrected": corrected,
            "pattern": pattern
        })
    return audits

@mcp.tool()
def update_grammar_log(sessionPath: str, projectDir: str | None = None) -> str:
    """Extract grammar audits from a session and update the English learning log."""
    project_dir = get_project_dir(projectDir)
    
    with open(sessionPath, "r", encoding="utf-8") as f:
        session_data = json.load(f)
        
    messages = session_data.get("messages", [])
    all_content = "\n".join([m.get("content", "") for m in messages if isinstance(m.get("content"), str)])
    audits = extract_grammar_audits(all_content)
    
    english_log_path = Path(project_dir) / "project" / "neo" / "src" / "English_Learning_Log.md"
    
    if audits:
        log_content = ""
        if english_log_path.exists():
            log_content = english_log_path.read_text(encoding="utf-8")
        else:
            english_log_path.parent.mkdir(parents=True, exist_ok=True)
            
        today_str = datetime.now().strftime("%Y-%m-%d")
        new_entries = ""
        
        for audit in audits:
            if audit["original"] not in log_content:
                new_entries += f"| {today_str} | {audit['original']} | {audit['corrected']} | {audit['pattern']} |\n"
                
        if new_entries:
            with open(english_log_path, "a", encoding="utf-8") as f:
                f.write(new_entries)
            return f"Updated grammar log with {len(audits)} entries."
            
    return "No new grammar audits found."

@mcp.tool()
def archive_session(sessionPath: str, projectDir: str | None = None) -> str:
    """Archive a Gemini session into daily memory files and extract grammar audits."""
    project_dir = get_project_dir(projectDir)
    
    with open(sessionPath, "r", encoding="utf-8") as f:
        session_data = json.load(f)
        
    session_id = session_data.get("sessionId", "")
    messages = session_data.get("messages", [])
    start_time = session_data.get("startTime", "")
    summary = session_data.get("summary", "")
    
    # 1. Update Grammar Log
    all_content = "\n".join([m.get("content", "") for m in messages if isinstance(m.get("content"), str)])
    audits = extract_grammar_audits(all_content)
    english_log_path = Path(project_dir) / "project" / "neo" / "src" / "English_Learning_Log.md"
    
    if audits:
        try:
            log_content = ""
            if english_log_path.exists():
                log_content = english_log_path.read_text(encoding="utf-8")
            else:
                english_log_path.parent.mkdir(parents=True, exist_ok=True)
                
            today_str = datetime.now().strftime("%Y-%m-%d")
            new_entries = ""
            for audit in audits:
                if audit["original"] not in log_content:
                    new_entries += f"| {today_str} | {audit['original']} | {audit['corrected']} | {audit['pattern']} |\n"
            if new_entries:
                with open(english_log_path, "a", encoding="utf-8") as f:
                    f.write(new_entries)
        except Exception as e:
            print(f"Failed to update grammar log: {e}")
            
    # 2. Archive to Memory
    memory_dir = Path(project_dir) / "history" / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    memory_file = memory_dir / f"{today}.md"
    
    # Deduplication
    if session_id:
        try:
            if memory_file.exists():
                existing_memory = memory_file.read_text(encoding="utf-8")
                if session_id in existing_memory:
                    return f"Session {session_id} already archived."
        except Exception:
            pass
            
    lines = []
    for m in messages:
        if m.get("type") == "user":
            content = m.get("content", "")
            if isinstance(content, list):
                # Try to extract text from list (e.g., multimodal blocks)
                content = next((item.get("text", "") for item in content if "text" in item), "")
                
            if isinstance(content, str) and content:
                # Filter out [System Override] blocks
                content = re.sub(r'\[System Override\][\s\S]*?(?=\n\n|$|\[)', '', content).strip()
                if content:
                    lines.append(f"### User\n{content[:200]}")
                    
        elif m.get("type") == "gemini":
            text = m.get("content", "")
            if isinstance(text, str) and text:
                quoted = "\n".join([f"> {line}" for line in text.strip()[:500].split("\n")])
                lines.append(f"### Neo\n{quoted}")

    if lines:
        if start_time:
            try:
                # Handle ISO formatting parsing if needed or fallback to generic formatting
                dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                time_str = dt.strftime("%H:%M")
            except Exception:
                time_str = datetime.now().strftime("%H:%M")
        else:
            time_str = datetime.now().strftime("%H:%M")
            
        topic = summary or "对话记录"
        
        output = f"\n## {time_str} {topic}\n"
        output += f"<!-- session: {session_id} -->\n"
        output += "\n\n".join(lines) + "\n\n"
        
        with open(memory_file, "a", encoding="utf-8") as f:
            f.write(output)
            
        # Git commit
        try:
            subprocess.run(["git", "add", "history/memory/", "project/neo/src/English_Learning_Log.md"], cwd=project_dir, check=False)
            subprocess.run(["git", "commit", "-m", f"chore: 自动归档对话记忆 {today}", "--no-verify"], cwd=project_dir, check=False)
        except Exception:
            pass
            
        return f"Successfully archived session {session_id} to {memory_file}"
        
    return "No valid messages to archive."

if __name__ == "__main__":
    mcp.run()
