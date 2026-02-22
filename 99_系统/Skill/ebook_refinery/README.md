---
type: tool
name: Ebook Refinery
language: python
version: 1.0.0
dependencies: [pandoc]
tags:
  - tool
  - skill
  - automation
---

# 📚 Tool: Ebook Refinery (电子书炼油厂)

> **一句话定位**: 专为 Inkbrain 设计的知识 ETL 工具。一键将 EPUB 电子书炸碎、清洗、重组为原子化的 Markdown 章节。

## 🚀 如何使用 (Usage)

1.  将 `.epub` 文件丢入 `00_收集` 目录。
2.  在终端运行：
    ```bash
    cd "Documents/inkbrain"
    python3 "99_系统/Skills/ebook_refinery.py" "00_收集/你的书名.epub"
    ```
3.  **Gemini Agent**: 或者直接对我下令：“把收集箱里的那本书炼了”。

## ⚙️ 功能特性 (Features)

*   ✅ **Format Shift**: 借力 Pandoc 实现无损转换。
*   ✅ **Atomic Split**: 智能识别一级标题，按章节拆分文件。
*   ✅ **Deep Clean**: 
    *   移除 `[]{.calibre}` 等样式噪音。
    *   压缩多余空行，实现紧凑排版。
    *   移除 HTML 锚点。
*   ✅ **Auto Index**: 自动生成 `00_目录.md`。

## 📜 源代码 (Source Code)

> **File Path**: `99_系统/Skills/ebook_refinery.py`

```python
#!/usr/bin/env python3
"""
📚 Ebook Refinery (电子书炼油厂) - Inkbrain Skill
================================================
Usage: python3 ebook_refinery.py <path_to_epub> [output_dir]
"""

import os
import sys
import re
import subprocess
import shutil

def check_pandoc():
    """检查是否安装了 pandoc"""
    if shutil.which("pandoc") is None:
        print("❌ Error: 未找到 pandoc。请先运行 'brew install pandoc'")
        sys.exit(1)

def clean_content(content):
    """深度清洗 Markdown 内容"""
    # 1. 清洗 [text]{...} 标签
    while re.search(r"[^\]*?)\]\{[^\}]*?\}", content):
        content = re.sub(r"[^\]*?)\]\{[^\}]*?\}", r"\1", content)
    
    # 2. 清洗单独的 []{...} 和 HTML 锚点
    content = re.sub(r"[]\{[^\}]*?\}", "", content)
    content = re.sub(r"\{{#[^\}]*?\}}", "", content)
    content = re.sub(r"</?span[^>]*>", "", content)
    content = re.sub(r"</?div[^>]*>", "", content)
    
    # 3. 激进的空行压缩 (逐行处理)
    lines = content.splitlines()
    new_lines = []
    last_line_empty = False
    
    for line in lines:
        stripped = line.strip()
        if stripped:
            new_lines.append(stripped)
            last_line_empty = False
        else:
            if not last_line_empty:
                new_lines.append("") # 保留一个空行
                last_line_empty = True
    
    return "\n".join(new_lines)

def process_ebook(epub_path, base_output_dir):
    filename = os.path.basename(epub_path)
    book_name = os.path.splitext(filename)[0]
    
    # 设置输出目录: 03_文章/<书名全集>
    if not base_output_dir:
        base_output_dir = "03_文章"
    
    output_dir = os.path.join(base_output_dir, f"{book_name}全集")
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"📖 开始炼制: {book_name}")
    print(f"📂 输出目录: {output_dir}")
    
    # 1. Pandoc 转换
    temp_md = os.path.join(output_dir, "full_temp.md")
    print("   ↳ 正在转换格式 (EPUB -> Markdown)...")
    subprocess.run(["pandoc", epub_path, "-o", temp_md], check=True)
    
    # 2. 读取并拆分
    print("   ↳ 正在拆分章节...")
    with open(temp_md, "r", encoding="utf-8") as f:
        full_content = f.read()
    
    # 按一级标题拆分
    chapters = re.split(r"(^# .+)", full_content, flags=re.MULTILINE)
    
    toc_lines = [f"# {book_name} - 目录\n"]
    chapter_count = 0
    
    # 跳过序言之前的垃圾，从第一个标题开始
    # split 结果 [preamble, title1, body1, title2, body2...]
    start_index = 1
    if len(chapters) < 2: 
        # 如果没有一级标题，尝试二级标题 (有些书格式不同)
        print("   ⚠️ 未检测到一级标题，尝试按二级标题拆分...")
        chapters = re.split(r"(^## .+)", full_content, flags=re.MULTILINE)
    
    for i in range(start_index, len(chapters), 2):
        title_line = chapters[i].strip()
        body = chapters[i+1] if i+1 < len(chapters) else ""
        
        # 提取纯标题
        clean_title = re.sub(r"\{{#.*?\}}", "", title_line).replace("#", "").strip()
        safe_filename = re.sub(r"[/:*?"<>|]", "_", clean_title)
        
        # 3. 清洗内容
        full_text = f"# {clean_title}\n\n{body}"
        cleaned_text = clean_content(full_text)
        
        # 写入文件
        chapter_count += 1
        file_name = f"{chapter_count:03d}_{safe_filename}.md"
        file_path = os.path.join(output_dir, file_name)
        
        with open(file_path, "w", encoding="utf-8") as f:
            # YAML Header
            f.write(f"---\ntitle: {clean_title}\ntype: chapter\nbook: {book_name}\n---\n\n")
            f.write(cleaned_text)
            
        toc_lines.append(f"- [[{file_name}|{clean_title}']]")
    
    # 4. 生成目录
    with open(os.path.join(output_dir, "00_目录.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(toc_lines))
    
    # 5. 清理
    os.remove(temp_md)
    
    print(f"✅ 炼制完成！共生成 {chapter_count} 个章节。\n")
    print(f"🔗 入口文件: {output_dir}/00_目录.md")

if __name__ == "__main__":
    check_pandoc()
    if len(sys.argv) < 2:
        print("Usage: python3 ebook_refinery.py <epub_file>")
        sys.exit(1)
        
    epub_file = sys.argv[1]
    process_ebook(epub_file, sys.argv[2] if len(sys.argv) > 2 else None)
```