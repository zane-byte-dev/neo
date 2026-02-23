#!/bin/bash

# ==========================================
# 🐍 设置 Python 3.12 为默认版本
# ==========================================

echo "🔧 配置 Python 3.12 为默认 python3..."

# 备份 .zshrc
cp ~/.zshrc ~/.zshrc.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 已备份 ~/.zshrc"

# 移除旧的 Python 路径配置
sed -i '' '/python@3\.13/d' ~/.zshrc
sed -i '' '/python@3\.14/d' ~/.zshrc

# 添加 Python 3.12 到 PATH（放在最前面）
if ! grep -q 'python@3.12' ~/.zshrc; then
    echo '' >> ~/.zshrc
    echo '# Python 3.12 (默认版本 - 支持所有依赖)' >> ~/.zshrc
    echo 'export PATH="/opt/homebrew/opt/python@3.12/libexec/bin:$PATH"' >> ~/.zshrc
    echo "✅ 已添加 Python 3.12 到 PATH"
else
    echo "✅ Python 3.12 路径已存在"
fi

echo ""
echo "✅ 配置完成！"
echo ""
echo "📊 验证版本："
/opt/homebrew/opt/python@3.12/bin/python3 --version

echo ""
echo "🎯 接下来请执行："
echo ""
echo "# 1. 重新加载配置"
echo "source ~/.zshrc"
echo ""
echo "# 2. 验证版本（应该显示 Python 3.12.12）"
echo "python3 --version"
echo ""
echo "# 3. 启动 Typeless"
echo "cd '/Users/zhengchao/Library/Mobile Documents/iCloud~md~obsidian/Documents/inkbrain/99_系统/Skills'"
echo "python3 typeless_server.py"
