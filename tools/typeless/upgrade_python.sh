#!/bin/bash

# ==========================================
# 🐍 Python 升级脚本
# ==========================================

echo "🔧 正在修复 Homebrew 权限..."

# 修复 Homebrew 目录权限
sudo chown -R zhengchao /Users/zhengchao/Library/Logs/Homebrew /opt/homebrew

echo "✅ 权限修复完成"
echo ""
echo "📦 正在安装 Python 3.13..."

# 安装 Python 3.13
brew install python@3.13

echo ""
echo "🔗 设置 Python 3.13 为默认版本..."

# 添加到 PATH
echo 'export PATH="/opt/homebrew/opt/python@3.13/bin:$PATH"' >> ~/.zshrc

# 立即生效
export PATH="/opt/homebrew/opt/python@3.13/bin:$PATH"

echo ""
echo "📦 安装 Typeless 所需的依赖..."

# 安装依赖
/opt/homebrew/opt/python@3.13/bin/pip3 install \
    sounddevice \
    scipy \
    numpy \
    google-generativeai \
    pynput \
    requests \
    faster-whisper \
    python-dotenv

echo ""
echo "✅ Python 升级完成！"
echo ""
echo "📊 当前版本信息："
/opt/homebrew/opt/python@3.13/bin/python3 --version

echo ""
echo "🎯 下一步："
echo "1. 关闭并重新打开终端（或运行 source ~/.zshrc）"
echo "2. 运行 python3 --version 确认版本"
echo "3. 重新启动 typeless_server.py"
echo ""
echo "💡 启动命令："
echo "cd '/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/99_系统/Skills'"
echo "python3 typeless_server.py"
