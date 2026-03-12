import os
import sys
import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify as md
from pathlib import Path
from datetime import datetime
import re

def sanitize_filename(title: str) -> str:
    import re
    cleaned = re.sub(r'[\\/*?:<>|"]', '', title)
    return cleaned.strip()[:100]

def fetch_via_jina(url: str) -> dict[str, str]:
    jina_url = f"https://r.jina.ai/{url}"
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'text/markdown'}
    with httpx.Client(timeout=30.0) as client:
        res = client.get(jina_url, headers=headers)
        res.raise_for_status()
        content = res.text
        
        title = 'Untitled Clipper'
        for line in content.split('\n')[:10]:
            if line.startswith('Title: '):
                title = line[7:].strip()
                break
            if line.startswith('# '):
                title = line[2:].strip()
                break
                
        return {"title": title, "content": content}

def fetch_via_local(url: str) -> dict[str, str]:
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; NeoAgent-Clipper/1.0)'}
    with httpx.Client(timeout=20.0) as client:
        res = client.get(url, headers=headers)
        res.raise_for_status()
        html = res.text
        
        soup = BeautifulSoup(html, 'html.parser')
        title = soup.title.string.strip() if soup.title else 'Untitled'
        
        for element in soup(["script", "style", "nav", "header", "footer"]):
            element.decompose()
            
        content = md(str(soup), heading_style="ATX", default_title=True).strip()
        # Clean excessive newlines
        content = re.sub(r'\n{3,}', '\n\n', content)
        
        return {"title": title, "content": content}

def fetch_markdown(url: str) -> dict[str, str]:
    try:
        result = fetch_via_jina(url)
        result["source"] = "jina"
        return result
    except Exception as jina_err:
        print(f"[Clipper] ⚠️ Jina failed ({jina_err}), trying local fallback...", file=sys.stderr)
        try:
            result = fetch_via_local(url)
            result["source"] = "local"
            return result
        except Exception as local_err:
            raise RuntimeError(f"Both strategies failed.\n  Jina: {jina_err}\n  Local: {local_err}")

def clip_url(url: str, target_dir: str | None = None) -> str:
    from dotenv import load_dotenv
    load_dotenv()
    
    vault_dir = os.environ.get("GEMINI_WORK_DIR")
    
    if target_dir and Path(target_dir).exists():
        save_dir = Path(target_dir)
    elif target_dir and vault_dir:
        save_dir = Path(vault_dir) / target_dir
    elif vault_dir:
        save_dir = Path(vault_dir) / 'inbox'
    else:
        raise RuntimeError("GEMINI_WORK_DIR not set and no absolute target_dir provided")
        
    save_dir.mkdir(parents=True, exist_ok=True)
    
    result = fetch_markdown(url)
    title = result["title"]
    content = result["content"]
    source = result["source"]
    
    safe_title = sanitize_filename(title)
    today = datetime.now().strftime("%Y-%m-%d")
    
    markdown = f"""---
title: {title}
url: {url}
date: {today}
type: clipper
source: {source}
tags: [inbox]
---

{content}"""

    file_path = save_dir / f"{safe_title}.md"
    counter = 1
    while file_path.exists():
        file_path = save_dir / f"{safe_title}_{counter}.md"
        counter += 1
        
    file_path.write_text(markdown, encoding='utf-8')
    return str(file_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python clipper.py <url> [target_dir]", file=sys.stderr)
        sys.exit(1)
        
    url = sys.argv[1]
    target_dir = sys.argv[2] if len(sys.argv) > 2 else None
    
    print(f"✂️ Clipping: {url}")
    try:
        path = clip_url(url, target_dir)
        print(f"✅ Saved to: {path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
