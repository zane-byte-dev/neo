import os
import subprocess
from datetime import datetime
from pathlib import Path
import sys

def get_project_root() -> Path:
    env_dir = os.environ.get("GEMINI_WORK_DIR")
    if env_dir:
        return Path(env_dir)
    return Path(os.getcwd()).parent.parent

def archive_diary(project_root: Path) -> int:
    history_dir = project_root / 'history'
    moved_count = 0
    if not history_dir.is_dir():
        return 0
        
    today_str = datetime.now().strftime("%Y-%m-%d")
    today_file = f"{today_str}.md"
    exclude_files = ['日记模版.md', today_file]
    
    for item in history_dir.iterdir():
        if not item.is_file() or not item.name.endswith('.md') or item.name in exclude_files:
            continue
            
        if len(item.name) == 13 and item.name[:4].isdigit() and item.name[4] == '-' and item.name[5:7].isdigit():
            year = item.name[:4]
            month = item.name[5:7]
            
            target_dir = history_dir / year / month
            target_dir.mkdir(parents=True, exist_ok=True)
            
            target_path = target_dir / item.name
            item.rename(target_path)
            moved_count += 1
            
    return moved_count

def clean_inbox(project_root: Path) -> int:
    inbox_dir = project_root / 'inbox'
    deleted_count = 0
    if not inbox_dir.is_dir():
        return 0
        
    for root, dirs, files in os.walk(inbox_dir):
        for file in files:
            if file == '.DS_Store' or file.startswith('._'):
                continue
                
            full_path = Path(root) / file
            try:
                stats = full_path.stat()
                if stats.st_size == 0:
                    full_path.unlink()
                    deleted_count += 1
                elif file.endswith('.md') and stats.st_size < 10:
                    content = full_path.read_text(encoding='utf-8')
                    if not content.strip():
                        full_path.unlink()
                        deleted_count += 1
            except Exception as e:
                print(f"[Butler] Error processing file {file}: {e}", file=sys.stderr)
                
    return deleted_count

def git_commit(project_root: Path) -> str:
    try:
        status_out = subprocess.run(['git', 'status', '--porcelain'], cwd=project_root, capture_output=True, text=True, check=True).stdout
        if not status_out.strip():
            return '✓ 工作区干净，无需提交。'
            
        subprocess.run(['git', 'add', 'history/'], cwd=project_root, check=True)
        subprocess.run(['git', 'add', 'inbox/'], cwd=project_root, check=True)
        
        diff_res = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=project_root)
        if diff_res.returncode == 0:
            return '✓ history 和 inbox 目录下无实质变更。'
        else:
            subprocess.run(['git', 'commit', '-m', 'chore: 🤖 管家日常清扫'], cwd=project_root, check=True)
            return '✅ 已成功固化管家清扫的里程碑版本。'
    except Exception as e:
        return f'❌ Git 执行失败: {e}'

def run_maintenance() -> str:
    try:
        project_root = get_project_root()
        logs = []
        
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        logs.append(f"🕰️ [{time_str}] 🤖 管家开始日常巡检。")
        
        archived_count = archive_diary(project_root)
        if archived_count > 0:
            logs.append(f"➡️ 归档历史日记: {archived_count} 篇")
        else:
            logs.append("✓ 没有需要归档的旧日记。")
            
        deleted_count = clean_inbox(project_root)
        if deleted_count > 0:
            logs.append(f"❌ 清理 Inbox 垃圾碎片: {deleted_count} 份")
        else:
            logs.append("✓ Inbox 保持清洁，未发现垃圾。")
            
        if archived_count > 0 or deleted_count > 0:
            commit_result = git_commit(project_root)
            logs.append(commit_result)
            
        logs.append("\n✨ 巡检完毕，您的知识库一尘不染。")
        return "\n".join(logs)
    except Exception as e:
        return f"❌ 管家巡检过程中发生严重错误: {e}"

if __name__ == '__main__':
    print(run_maintenance())
