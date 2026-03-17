import os
import sys
import asyncio
from pathlib import Path
import re
import edge_tts

DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
CONCURRENCY = 3

def clean_markdown(text: str) -> str:
    text = re.sub(r'^---[\s\S]*?---\n', '', text, flags=re.MULTILINE) # frontmatter
    text = re.sub(r'```[\s\S]*?```', '', text) # code blocks
    text = re.sub(r'`[^`]*`', '', text) # inline code
    text = re.sub(r'^#{1,6}\s', '', text, flags=re.MULTILINE) # headings
    text = re.sub(r'\*\*|__|[*_]', '', text) # bold/italic
    text = re.sub(r'!\[([^\]]*)\]\([^)]+\)', '', text) # images
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text) # links -> text
    text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', text) # WikiLinks
    text = re.sub(r'!\[\[.*?\]\]', '', text) # Obsidian embeds
    text = re.sub(r'<[^>]+>', '', text) # HTML tags
    text = re.sub(r'\n{3,}', '\n\n', text) # excessive newlines
    return text.strip()

async def process_file(file_path: Path, voice: str) -> str:
    name = file_path.stem
    audio_dir = file_path.parent / 'Audio'
    output_path = audio_dir / f"{name}.mp3"
    
    audio_dir.mkdir(parents=True, exist_ok=True)
    
    if output_path.exists():
        if file_path.stat().st_mtime < output_path.stat().st_mtime:
            return f"⏩ Skipped (up to date): {file_path.name}"
            
    raw = file_path.read_text(encoding='utf-8')
    clean_text = clean_markdown(raw)
    
    if not clean_text:
        return f"⚠️ Skipped (empty): {file_path.name}"
        
    communicate = edge_tts.Communicate(clean_text, voice)
    await communicate.save(str(output_path))
    
    embed_string = f"![[Audio/{name}.mp3]]"
    if embed_string not in raw:
        match = re.search(r'^---[\s\S]*?---\n', raw, flags=re.MULTILINE)
        if match:
            new_content = raw[:match.end()] + f"{embed_string}\n\n" + raw[match.end():]
        else:
            new_content = f"{embed_string}\n\n{raw}"
            
        file_path.write_text(new_content, encoding='utf-8')
        
    return f"✅ Generated: {output_path.name}"

async def run_with_concurrency(tasks, limit):
    semaphore = asyncio.Semaphore(limit)
    async def sem_task(task):
        async with semaphore:
            return await task()
    
    return await asyncio.gather(*(sem_task(t) for t in tasks))

async def audio_refinery(target: str, voice: str = DEFAULT_VOICE) -> str:
    target_path = Path(target)
    files = []
    
    if not target_path.exists():
        raise RuntimeError(f"Path not found: {target}")
        
    if target_path.is_file() and target_path.suffix in ['.md', '.txt']:
        files.append(target_path)
    elif target_path.is_dir():
        for root, dirs, filenames in os.walk(target_path):
            if 'Audio' in dirs:
                dirs.remove('Audio')
            for f in filenames:
                if f.endswith('.md'):
                    files.append(Path(root) / f)
                    
    if not files:
        return "⚠️ No Markdown files found."
        
    tasks = [lambda f=f: process_file(f, voice) for f in files]
    results = await run_with_concurrency(tasks, CONCURRENCY)
    
    return "\n".join(results)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python audio_refinery.py <file_or_dir> [voice]", file=sys.stderr)
        sys.exit(1)
        
    target_arg = sys.argv[1]
    voice_arg = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_VOICE
    
    print("🎧 Audio Refinery starting...")
    try:
        output = asyncio.run(audio_refinery(target_arg, voice_arg))
        print(output)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
