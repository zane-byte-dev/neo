#!/usr/bin/env python3
"""
✂️ Inkbrain Clipper
====================
Usage: python3 clipper.py <url> [target_dir]

功能：
1. 下载 URL 内容并转换为 Markdown (使用 r.jina.ai 服务)。
2. 自动保存到 Obsidian 的 '00_收集' 目录 (或指定目录)。
3. 自动唤起 Obsidian 打开该文件。

Dependencies:
    None (Uses built-in urllib)
"""

import os
import sys
import re
import urllib.request
import urllib.parse
from datetime import datetime

# 导入 Lib 下的 obs_open 模块
script_dir = os.path.dirname(os.path.abspath(__file__))
lib_dir = os.path.abspath(os.path.join(script_dir, "../../Lib"))
if lib_dir not in sys.path:
    sys.path.append(lib_dir)

try:
    from obs_open import open_in_obsidian
except ImportError:
    import subprocess
    
    def open_in_obsidian(path):
        VAULT_NAME = "inkbrain"
        abs_path = os.path.abspath(path)
        subprocess.run(["open", abs_path])

def sanitize_filename(title):
    # 移除非法字符
    title = re.sub(r'[\\/*?:\"<>|]', "", title)
    return title.strip()[:100]

def fetch_and_convert(url):
    print(f"🌐 Fetching: {url} ...")
    
    # 使用 Jina Reader API
    jina_url = f"https://r.jina.ai/{url}"
    
    try:
        req = urllib.request.Request(jina_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            content = response.read().decode('utf-8')
        
        # 尝试从内容提取标题
        lines = content.split('\n')
        title = "Untitled Clipper"
        for line in lines[:10]: # 只在前10行找
            if line.startswith("Title: "):
                title = line.replace("Title: ", "").strip()
                break
            elif line.startswith("# "):
                title = line.replace("# ", "").strip()
                break
            
        return title, content
        
    except Exception as e:
        print(f"❌ Error fetching URL: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 clipper.py <url> [subdir_name]")
        sys.exit(1)
        
    url = sys.argv[1]
    
    # 路径解析
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # 向上两级到达 inkbrain 根目录 (99_系统/Skills/clipper.py -> 99_系统 -> inkbrain)
    base_dir = os.path.dirname(os.path.dirname(script_dir))
    target_dir = os.path.join(base_dir, "00_收集")
    
    # 如果用户指定了子目录
    if len(sys.argv) > 2:
        custom_dir = sys.argv[2]
        if os.path.isabs(custom_dir):
            target_dir = custom_dir
        else:
            potential_dir = os.path.join(base_dir, custom_dir)
            if os.path.isdir(potential_dir):
                target_dir = potential_dir
            
    if not os.path.exists(target_dir):
        os.makedirs(target_dir, exist_ok=True)

    # 1. 获取内容
    title, content = fetch_and_convert(url)
    safe_title = sanitize_filename(title)
    
    # 2. 构造文件元数据
    today = datetime.now().strftime("%Y-%m-%d")
    header = f"""
---
title: {title}
url: {url}
date: {today}
type: clipper
tags: [inbox]
---

"""
    full_content = header + content
    
    # 3. 保存文件
    file_path = os.path.join(target_dir, f"{safe_title}.md")
    
    # 避免覆盖
    counter = 1
    original_file_path = file_path
    while os.path.exists(file_path):
        file_path = os.path.join(target_dir, f"{safe_title}_{counter}.md")
        counter += 1
        
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(full_content)
        
    print(f"✅ Saved to: {file_path}")
    
    # 4. 打开 Obsidian
    open_in_obsidian(file_path)

if __name__ == "__main__":
    main()