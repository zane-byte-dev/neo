#!/bin/bash

# ==========================================
# 🌍 Typeless 语言配置（仅中英）
# ==========================================

echo "🌍 Typeless 语言配置"
echo ""
echo "1. 中英混合，英文不翻译（推荐）"
echo "   INPUT_LANGUAGE=auto OUTPUT_LANGUAGE=auto"
echo ""
echo "2. 纯中文"
echo "   INPUT_LANGUAGE=zh OUTPUT_LANGUAGE=zh"
echo ""
echo "3. 纯英文"
echo "   INPUT_LANGUAGE=en OUTPUT_LANGUAGE=en"
echo ""
read -p "选择 (1-3，直接回车=1): " choice
choice=${choice:-1}

case $choice in
    1) INPUT_LANG="auto"; OUTPUT_LANG="auto" ;;
    2) INPUT_LANG="zh";   OUTPUT_LANG="zh"   ;;
    3) INPUT_LANG="en";   OUTPUT_LANG="en"   ;;
    *) INPUT_LANG="auto"; OUTPUT_LANG="auto" ;;
esac

echo ""
echo "🚀 启动: INPUT_LANGUAGE=$INPUT_LANG OUTPUT_LANGUAGE=$OUTPUT_LANG"
echo ""

INPUT_LANGUAGE=$INPUT_LANG OUTPUT_LANGUAGE=$OUTPUT_LANG python3 typeless_server.py
