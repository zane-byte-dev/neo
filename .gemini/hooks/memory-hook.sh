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
    # 尝试用 project hash 目录
    CHATS_DIR=$(find "$HOME/.gemini/tmp" -type d -name "chats" 2>/dev/null | head -1)
fi

if [ -z "$CHATS_DIR" ] || [ ! -d "$CHATS_DIR" ]; then
    log "找不到 chats 目录，跳过"
    echo '{}'
    exit 0
fi

# 找最新的 session 文件（如果有 SESSION_ID 就精确匹配，否则取最新的）
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

# 用 python3 提取对话内容
MEMORY_DIR="$PROJECT_DIR/history/logs/memory"
mkdir -p "$MEMORY_DIR"

TODAY=$(date +%Y-%m-%d)
MEMORY_FILE="$MEMORY_DIR/$TODAY.md"

python3 -c "
import json, sys, os
from datetime import datetime

session_file = sys.argv[1]
memory_file = sys.argv[2]

with open(session_file) as f:
    data = json.load(f)

messages = data.get('messages', [])
start_time = data.get('startTime', '')
summary = data.get('summary', '')

# 只提取 user 和 gemini 类型的消息
lines = []
for m in messages:
    msg_type = m.get('type', '')
    content = m.get('content', '')
    
    if msg_type == 'user':
        # content 是 [{text: ...}] 格式
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and 'text' in part:
                    text = part['text'].strip()
                    if text:
                        lines.append(f'- **User**: {text[:200]}')
        elif isinstance(content, str) and content.strip():
            lines.append(f'- **User**: {content.strip()[:200]}')
    
    elif msg_type == 'gemini':
        if isinstance(content, str) and content.strip():
            # 截取前 200 字符
            text = content.strip().replace('\n', ' ')[:200]
            lines.append(f'- **Neo**: {text}')

# 如果消息太少（少于 2 条有效对话），跳过
user_count = sum(1 for l in lines if l.startswith('- **User**'))
if user_count < 1:
    print('SKIP', file=sys.stderr)
    sys.exit(0)

# 生成时间戳
try:
    t = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    time_str = t.strftime('%H:%M')
except:
    time_str = datetime.now().strftime('%H:%M')

# 组装输出
topic = summary if summary else '对话记录'
output = f'\n## {time_str} {topic}\n'
# 最多保留 20 条消息摘要
for line in lines[:20]:
    output += line + '\n'

# 追加到 memory 文件
with open(memory_file, 'a') as f:
    f.write(output)

print(f'写入 {len(lines)} 条消息到 {memory_file}', file=sys.stderr)
" "$SESSION_FILE" "$MEMORY_FILE"

# git commit（静默，失败不阻塞）
cd "$PROJECT_DIR"
git add "history/logs/memory/" 2>/dev/null && \
git commit -m "chore: 自动归档对话记忆 $TODAY" --no-verify 2>/dev/null || true

log "完成"

# hook 必须输出 JSON 到 stdout
echo '{}'
