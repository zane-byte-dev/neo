import os
import sys
import subprocess
import random
from pathlib import Path
from datetime import datetime

def get_project_root() -> Path:
    env_dir = os.environ.get("GEMINI_WORK_DIR")
    if env_dir:
        return Path(env_dir)
    return Path(os.getcwd()).parent.parent

def get_archived_diaries(project_root: Path) -> list[Path]:
    history_dir = project_root / 'history'
    all_files = []
    
    if not history_dir.is_dir():
        return []
        
    for item in history_dir.iterdir():
        if item.is_dir() and len(item.name) == 4 and item.name.isdigit():
            # Year directory
            for root, dirs, files in os.walk(item):
                for file in files:
                    if file.endswith('.md'):
                        all_files.append(Path(root) / file)
                        
    return all_files

def run_curator() -> str:
    try:
        project_root = get_project_root()
        archives = get_archived_diaries(project_root)
        
        if not archives:
            return '⚠️ [策展人] 未在归档库 (history/YYYY/MM) 中发现任何旧日记，无法完成策展。'
            
        selected_file = random.choice(archives)
        file_name = selected_file.stem
        
        content = selected_file.read_text(encoding='utf-8')
        if len(content) > 3000:
            content = content[:3000] + '... (内容已截断)'
            
        today_str = datetime.now().strftime("%Y-%m-%d")
        prompt_context = f"""[任务：每日策展]
时间线：这里有一篇尘封在历史归档中的旧日记，写于【{file_name}】。
内容如下：
---
{content}
---

要求：
1. 请你以“策展人”(Curator)的身份阅读这篇旧日记。
2. 从中萃取出 1-2 个闪光点或者和当下（{today_str}）有跨时空连线意义的内容。
3. 请以温和、睿智的老友口吻，写一段 100-200 字以内的点评和感悟，通过你的导读将它推给我。
4. 语言必须干净、直接，切忌长篇大论。"""

        print(f"[Curator] 正在召唤策展人... (精选文件: {file_name})")
        
        res = subprocess.run(['gemini', '-e', prompt_context], capture_output=True, text=True)
        response = res.stdout.strip()
        
        if res.returncode != 0 or not response or "⚠️" in response or "🔥" in response:
            return f"❌ [策展人] 唤醒失败或无思考产出：{response or res.stderr}"
            
        report = f"🕰️ **时空连线：来自 `{file_name}.md` 的只言片语**\n\n{response}\n\n--- \n_*(由 inkClaw 策展代理自动从归档区中挖掘并精炼)*_"
        return report
        
    except Exception as e:
        return f"❌ [策展人] 遭遇严重错误导致策展中断: {e}"

if __name__ == '__main__':
    print(run_curator())
