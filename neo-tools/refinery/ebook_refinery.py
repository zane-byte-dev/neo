import os
import sys
import subprocess
from pathlib import Path
import re
from dotenv import load_dotenv

def clean_content(content: str) -> str:
    result = re.sub(r'\[([^\]]*)\]\{[^}]*\}', r'\1', content)
    result = re.sub(r'\[\]\{[^}]*\}', '', result)
    result = re.sub(r'\{#[^}]*\}', '', result)
    result = re.sub(r'</?(span|div)[^>]*>', '', result)
    
    lines = result.split('\n')
    output = []
    last_empty = False
    
    for line in lines:
        stripped = line.strip()
        if stripped:
            output.append(stripped)
            last_empty = False
        elif not last_empty:
            output.append('')
            last_empty = True
            
    return '\n'.join(output)

def safe_filename(title: str) -> str:
    return re.sub(r'[/:*?"<>|]', '_', title).strip()

def ebook_refinery(epub_path: str, output_base_dir: str | None = None) -> str:
    load_dotenv()
    
    epub_file = Path(epub_path)
    if not epub_file.exists():
        raise RuntimeError(f"File not found: {epub_path}")
        
    try:
        subprocess.run(['pandoc', '--version'], capture_output=True, check=True)
    except FileNotFoundError:
        raise RuntimeError("pandoc not found. Install with: brew install pandoc")
        
    vault_dir = os.environ.get("GEMINI_WORK_DIR")
    book_name = epub_file.stem
    
    if output_base_dir:
        base_dir = Path(output_base_dir)
    elif vault_dir:
        base_dir = Path(vault_dir) / 'source'
    else:
        base_dir = Path('source')
        
    output_dir = base_dir / f"{book_name}全集"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    temp_md = output_dir / '_full_temp.md'
    print("[EbookRefinery] Converting EPUB -> Markdown...")
    subprocess.run(['pandoc', str(epub_file), '-o', str(temp_md)], check=True)
    
    full_content = temp_md.read_text(encoding='utf-8')
    temp_md.unlink()
    
    parts = re.split(r'^(# .+)$', full_content, flags=re.MULTILINE)
    toc_lines = [f"# {book_name} - 目录\n"]
    chapter_count = 0
    
    # parts looks like: [preamble, title1, body1, title2, body2...]
    for i in range(1, len(parts), 2):
        title_line = parts[i].strip()
        body = parts[i+1] if i + 1 < len(parts) else ''
        
        clean_title = re.sub(r'\{#.*?\}', '', title_line)
        clean_title = re.sub(r'^#\s*', '', clean_title).strip()
        safe_title = safe_filename(clean_title)
        
        full_text = f"# {clean_title}\n\n{body}"
        cleaned = clean_content(full_text)
        
        chapter_count += 1
        file_name = f"{chapter_count:03d}_{safe_title}.md"
        file_path = output_dir / file_name
        
        frontmatter = f"---\ntitle: {clean_title}\ntype: chapter\nbook: {book_name}\n---\n\n"
        file_path.write_text(frontmatter + cleaned, encoding='utf-8')
        
        toc_lines.append(f"- [[{file_name}|{clean_title}]]")
        
    toc_path = output_dir / '目录.md'
    toc_path.write_text('\n'.join(toc_lines), encoding='utf-8')
    
    return f"📚 炼制完成！共 {chapter_count} 个章节\n📂 输出目录：{output_dir}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ebook_refinery.py <file.epub> [output_dir]", file=sys.stderr)
        sys.exit(1)
        
    print("📚 Ebook Refinery starting...")
    try:
        epub_arg = sys.argv[1]
        out_arg = sys.argv[2] if len(sys.argv) > 2 else None
        print(ebook_refinery(epub_arg, out_arg))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
