#!/bin/bash
# SessionEnd Hook: 自动将对话记录归档到 memory 目录
# 由 gemini-cli 在会话结束时自动触发

set -e

# 环境变量由 gemini-cli 注入
PROJECT_DIR="${GEMINI_PROJECT_DIR:-$(pwd)}"
SESSION_ID="${GEMINI_SESSION_ID:-}"

# 调试信息输出到 stderr（hook 规范要求）
log() { echo "[memory-hook] $1" >&2; }

# 找到 session 文件
CHATS_DIR="$HOME/.gemini/tmp/neo/chats"
if [ ! -d "$CHATS_DIR" ]; then
    CHATS_DIR=$(find "$HOME/.gemini/tmp" -type d -name "chats" 2>/dev/null | head -1)
fi

if [ -z "$CHATS_DIR" ] || [ ! -d "$CHATS_DIR" ]; then
    log "找不到 chats 目录，跳过"
    echo '{}'
    exit 0
fi

# 找 session 文件：优先用 SESSION_ID 精确匹配
SESSION_FILE=""
if [ -n "$SESSION_ID" ]; then
    SESSION_FILE=$(find "$CHATS_DIR" -name "*${SESSION_ID}*" -type f 2>/dev/null | head -1)
fi

if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
    SESSION_FILE=$(ls -t "$CHATS_DIR"/session-*.json 2>/dev/null | head -1)
fi

if [ -z "$SESSION_FILE" ] || [ ! -f "$SESSION_FILE" ]; then
    log "找不到 session 文件，跳过"
    echo '{}'
    exit 0
fi

log "处理 session: $SESSION_FILE"

# 用 python3 提取对话内容和语法审计
MEMORY_DIR="$PROJECT_DIR/history/memory"
ENGLISH_LOG="$PROJECT_DIR/project/neo/src/English_Learning_Log.md"
mkdir -p "$MEMORY_DIR"

TODAY=$(date +%Y-%m-%d)
MEMORY_FILE="$MEMORY_DIR/$TODAY.md"

python3 - "$SESSION_FILE" "$MEMORY_FILE" "$ENGLISH_LOG" << 'EOF'
import json, sys, os, re
from datetime import datetime

session_file = sys.argv[1]
memory_file = sys.argv[2]
english_log = sys.argv[3]

with open(session_file) as f:
    data = json.load(f)

session_id = data.get('sessionId', '')
messages = data.get('messages', [])
start_time = data.get('startTime', '')
summary = data.get('summary', '')

# --- 提取语法审计 ---
audits = []
for m in messages:
    if m.get('type') == 'gemini':
        content = m.get('content', '')
        # 匹配模式: Grammar Audit: "**Original**" -> "**Corrected**" (Pattern)
        # 支持多行匹配和各种变体
        matches = re.findall(r'Grammar Audit: "\*\*?(.+?)\*\*?" -> "\*\*?(.+?)\*\*?"\s*(?:\((.+?)\))?', content)
        for original, corrected, pattern in matches:
            audits.append((original.strip(), corrected.strip(), pattern.strip() if pattern else "General Correction"))

if audits and os.path.exists(english_log):
    with open(english_log, 'a') as f:
        today_str = datetime.now().strftime('%Y-%m-%d')
        for orig, corr, patt in audits:
            # 简单去重：如果该条目已存在则跳过
            entry = f"| {today_str} | {orig} | {corr} | {patt} |"
            with open(english_log, 'r') as check_f:
                if orig not in check_f.read():
                    f.write(f"\n{entry}")

# --- 提取对话归档 ---
# 去重：检查 memory 文件里是否已经有这个 session 的记录
if session_id and os.path.exists(memory_file):
    with open(memory_file) as f:
        existing = f.read()
    if session_id in existing:
        print(f'session {session_id} 已存在，跳过', file=sys.stderr)
        sys.exit(0)

# 只提取 user 和 gemini 类型的消息
lines = []
for m in messages:
    msg_type = m.get('type', '')
    content = m.get('content', '')
    
    if msg_type == 'user':
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and 'text' in part:
                    text = part['text'].strip()
                    if text:
                        lines.append(f'### User\n{text[:200]}')
        elif isinstance(content, str) and content.strip():
            lines.append(f'### User\n{content.strip()[:200]}')
    
    elif msg_type == 'gemini':
        if isinstance(content, str) and content.strip():
            # 保留 Markdown 结构，但为了摘要简洁，限制总长度
            raw_text = content.strip()
            display_text = raw_text[:500] + "..." if len(raw_text) > 500 else raw_text
            # 每一行都加上 > 前缀，使其成为引用块
            quoted_text = "\n".join([f"> {line}" for line in display_text.split("\n")])
            lines.append(f"### Neo\n{quoted_text}")

# 如果消息太少，跳过
user_count = sum(1 for l in lines if l.startswith("### User"))
if user_count < 1:
    print('SKIP: 无有效对话', file=sys.stderr)
    sys.exit(0)

# 生成时间戳
try:
    t = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    time_str = t.strftime('%H:%M')
except:
    time_str = datetime.now().strftime('%H:%M')

# 组装输出（带 session_id 用于去重）
topic = summary if summary else '对话记录'
output = f'\n## {time_str} {topic}\n'
output += f'<!-- session: {session_id} -->\n'
for line in lines[:20]:
    output += line + '\n\n'

with open(memory_file, 'a') as f:
    f.write(output)

print(f'写入 {len(lines)} 条消息到 {memory_file}', file=sys.stderr)
EOF

# git commit（静默，失败不阻塞）
cd "$PROJECT_DIR"
git add "history/memory/" 2>/dev/null && \
git commit -m "chore: 自动归档对话记忆 $TODAY" --no-verify 2>/dev/null || true

log "完成"

# hook 必须输出 JSON 到 stdout
echo '{}'
