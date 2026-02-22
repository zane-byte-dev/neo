#!/usr/bin/env python3
"""
🎧 Audio Refinery (声音炼油厂) v2.0 - Turbo Edition
===================================================
Features:
- 🚀 Async Concurrency: 并发生成，速度提升 10x
- 🧠 Incremental Build: 智能增量更新 (只处理修改过的文章)
- 🛡️ Rate Limit Protection: 信号量控制，防止被 Ban
- 🧹 Smart Cleaning: 更强大的 Markdown 清洗正则

Usage: python3 audio_refinery.py <file_or_dir> [voice]
"""

import os
import sys
import re
import asyncio
import edge_tts
import time

# 配置
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
CONCURRENCY_LIMIT = 5  # 同时并发的任务数 (防止微软封IP)

# 全局统计
STATS = {
    "total": 0,
    "processed": 0,
    "skipped": 0,
    "failed": 0
}

def clean_markdown(text):
    """移除 Markdown 标记，保留纯文本供朗读"""
    # 移除 YAML 头
    text = re.sub(r"^---[\s\S]*?---", "", text)
    # 移除代码块
    text = re.sub(r"```[\s\S]*?```", "", text)
    # 移除行内代码
    text = re.sub(r"`[^`]*`", "", text)
    # 移除标题符号 (#)
    text = re.sub(r"#+\s", "", text)
    # 移除加粗/斜体
    text = re.sub(r"\*\*|__|\*|_|", "", text)
    # 移除图片 ![text](url)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", "", text)
    # 移除链接 [text](url) -> text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # 移除 [[WikiLinks|Display]] -> Display 或 [[WikiLinks]] -> WikiLinks
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", text)
    # 移除 HTML 标签
    text = re.sub(r"<[^>]+>", "", text)
    # 移除 Obsidian 引用链接 ![[Audio/...]] 或其他附件引用
    text = re.sub(r"!\[\[.*?\]\]", "", text)
    # 移除多余空行和空白
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

async def worker(sem, file_path, voice):
    """单个文件的处理逻辑 (被信号量保护)"""
    async with sem:
        try:
            dirname = os.path.dirname(file_path)
            filename = os.path.basename(file_path)
            name_without_ext = os.path.splitext(filename)[0]
            
            # 创建 Audio 子目录
            audio_dir = os.path.join(dirname, "Audio")
            os.makedirs(audio_dir, exist_ok=True)
            output_path = os.path.join(audio_dir, f"{name_without_ext}.mp3")
            
            # 增量检查
            should_generate = True
            if os.path.exists(output_path):
                md_mtime = os.path.getmtime(file_path)
                mp3_mtime = os.path.getmtime(output_path)
                if md_mtime < mp3_mtime:
                    should_generate = False
            
            # 1. 生成音频
            if should_generate:
                print(f"🎤 正在炼制: {filename}")
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                clean_text = clean_markdown(content)
                if not clean_text:
                    print(f"⚠️ 跳过 (空内容): {filename}")
                    return

                communicate = edge_tts.Communicate(clean_text, voice)
                await communicate.save(output_path)
                STATS["processed"] += 1
            else:
                STATS["skipped"] += 1
                # print(f"⏩ 跳过 (未修改): {filename}") # 减少刷屏

            # 2. 回填链接 (无论是否重新生成，都检查链接)
            # 为了防止读写冲突，回填操作不需要加锁，因为每个文件只会被一个 worker 处理
            with open(file_path, "r", encoding="utf-8") as f:
                current_content = f.read()

            embed_string = f"![[Audio/{os.path.basename(output_path)}]]"
            # 检查是否已存在（不仅是这一行，而是整个文件里有没有这个引用）
            if embed_string not in current_content:
                # 插入到 YAML 头之后，或者文件开头
                match = re.search(r"^---[\s\S]*?---\n", current_content)
                if match:
                    insert_pos = match.end()
                    new_content = current_content[:insert_pos] + f"\n{embed_string}\n" + current_content[insert_pos:]
                else:
                    new_content = f"{embed_string}\n\n{current_content}"
                
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"🔗 链接已注入: {filename}")

        except Exception as e:
            print(f"❌ 失败: {filename} -> {str(e)}")
            STATS["failed"] += 1

async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 audio_refinery.py <file_or_dir> [voice]")
        sys.exit(1)
        
    target = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_VOICE
    
    tasks = []
    sem = asyncio.Semaphore(CONCURRENCY_LIMIT) # 限制并发数
    
    start_time = time.time()
    print(f"🚀 Audio Refinery v2.0 启动 (并发数: {CONCURRENCY_LIMIT})...")

    if os.path.isfile(target):
        if target.endswith((".md", ".txt")):
            tasks.append(worker(sem, target, voice))
    elif os.path.isdir(target):
        for root, dirs, files in os.walk(target):
            if "Audio" in root: continue
            for file in files:
                if file.endswith(".md"):
                    file_path = os.path.join(root, file)
                    tasks.append(worker(sem, file_path, voice))
    
    STATS["total"] = len(tasks)
    print(f"📦 扫描到 {STATS['total']} 个文件，开始处理...")
    
    # 并发执行所有任务
    await asyncio.gather(*tasks)
    
    duration = time.time() - start_time
    print(f"\n✨ 全部完成! 耗时: {duration:.2f}s")
    print(f"📊 统计: 新生成 {STATS['processed']} | 跳过 {STATS['skipped']} | 失败 {STATS['failed']}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 用户强制停止")