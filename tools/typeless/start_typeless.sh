#!/bin/bash

# ==========================================
# 🎙️ Typeless 启动脚本 (Local Mode)
# ==========================================

echo "🚀 启动 Typeless Server (Local Mode)..."

# 自动进入本脚本所在目录
cd "$(dirname "$0")" || exit 1

# 使用 python3 启动
python3 typeless_server.py
