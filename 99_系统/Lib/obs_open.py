#!/usr/bin/env python3
import os
import sys
import urllib.parse
import subprocess

# 自动推断 Vault 名称 (根据当前目录结构)
# 默认设为 inkbrain，如果检测到其他父目录名可修改
VAULT_NAME = "inkbrain"

def open_in_obsidian(path):
    if not path:
        return

    # 1. 尝试解析为文件路径
    if os.path.exists(path) or path.endswith(".md"):
        abs_path = os.path.abspath(path)
        
        # 尝试找到 Vault 根目录的相对路径
        # 简单策略：查找 path 中 VAULT_NAME 的位置
        if VAULT_NAME in abs_path:
            # 获取 inkbrain/ 之后的部分
            rel_path = abs_path.split(f"{VAULT_NAME}/", 1)[1]
        else:
            # 如果找不到 vault 名，直接使用原始路径，Obsidian 有时能处理绝对路径，
            # 但通常需要相对路径。这里做个兜底，只传文件名。
            rel_path = os.path.basename(path)
            
        # URL 编码
        encoded_file = urllib.parse.quote(rel_path)
        uri = f"obsidian://open?vault={VAULT_NAME}&file={encoded_file}"
        
    # 2. 如果看起来像个 URL (http/https)，也许你是想用 Obsidian 的“网页剪藏”插件打开？
    # 目前原生不支持直接用 Obsidian 打开 http 链接浏览。
    # 但我们可以生成一个 Markdown 链接方便你复制。
    elif path.startswith("http"):
        print(f"🔗 Obsidian 无法直接浏览 Web URL。建议使用 'Repo - xxx' 格式保存。")
        print(f"Markdown Link: [{path}]({path})")
        return
        
    else:
        # 可能是个纯文件名，尝试打开
        encoded_file = urllib.parse.quote(path)
        uri = f"obsidian://open?vault={VAULT_NAME}&file={encoded_file}"

    print(f"🚀 Opening in Obsidian: {uri}")
    subprocess.run(["open", uri])

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: obs <file_path>")
        sys.exit(1)
    
    target = sys.argv[1]
    open_in_obsidian(target)
