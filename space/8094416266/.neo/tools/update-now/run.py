#!/usr/bin/env python3
"""
update-now — 更新 memory/NOW.md 短期记忆文件
stdin: JSON { args: { content }, context: { workDir } }
stdout: JSON { type: 'text', content: '...' }
"""
import json
import sys
import os
from datetime import datetime, timezone, timedelta


def main():
    raw = sys.stdin.read()
    data = json.loads(raw)
    args = data.get("args", {})
    context = data.get("context", {})

    content = (args.get("content") or "").strip()
    if not content:
        print(json.dumps({"type": "error", "content": "content is required"}))
        return

    tz = timezone(timedelta(hours=8))
    timestamp = datetime.now(tz).strftime("%Y/%m/%d %H:%M:%S")

    final_content = content.rstrip()
    if "*Updated:" not in final_content:
        final_content += f"\n\n---\n*Updated: {timestamp}*\n"

    out_dir = os.path.join(context["workDir"], "memory")
    out_path = os.path.join(out_dir, "NOW.md")

    try:
        os.makedirs(out_dir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(final_content)
        print(json.dumps({
            "type": "text",
            "content": f"✅ NOW.md 已更新（{len(final_content)} 字符）。",
        }))
    except Exception as e:
        print(json.dumps({"type": "error", "content": f"更新 NOW.md 失败: {e}"}))


if __name__ == "__main__":
    main()
