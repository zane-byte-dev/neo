#!/bin/bash

# ==========================================
# 🔧 修复 Python PATH 配置
# ==========================================

echo "🔧 正在修复 Python PATH..."

# 备份 .zshrc
cp ~/.zshrc ~/.zshrc.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 已备份 ~/.zshrc"

# 移除旧的 Python 3.13 特定路径
sed -i '' '/python@3.13/d' ~/.zshrc

# 确保 Homebrew bin 目录在 PATH 最前面
if ! grep -q 'export PATH="/opt/homebrew/bin:' ~/.zshrc; then
    echo '' >> ~/.zshrc
    echo '# Homebrew Python (最新版本)' >> ~/.zshrc
    echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
    echo "✅ 已添加 Homebrew 到 PATH"
else
    echo "✅ Homebrew 路径已存在"
fi

echo ""
echo "📦 安装 Python 依赖..."

# 使用正确的 Python 3.14 安装依赖
/opt/homebrew/bin/pip3 install \
    sounddevice \
    scipy \
    numpy \
    google-generativeai \
    pynput \
    requests \
    faster-whisper

echo ""
echo "✅ 配置完成！"
echo ""
echo "📊 验证版本："
/opt/homebrew/bin/python3 --version

echo ""
echo "🎯 接下来请执行："
echo ""
echo "# 1. 重新加载配置"
echo "source ~/.zshrc"
echo ""
echo "# 2. 验证版本"
echo "python3 --version"
echo ""
echo "# 3. 启动 Typeless"
echo "cd '/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/99_系统/Skills'"
echo "python3 typeless_server.py"
