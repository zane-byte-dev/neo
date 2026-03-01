import re
import os

def clean_html(filename):
    path = f"source/hezhiyan_outsea/{filename}.html"
    with open(path, "r", encoding='utf-8') as f:
        html = f.read()
    
    # 提取微信正文部分
    match = re.search(r'<div.*?id="js_content".*?>(.*?)</div>', html, re.DOTALL)
    if not match:
        print(f"No content in {filename}")
        return
    
    text = match.group(1)
    # 移除脚本和样式
    text = re.sub(r'<script.*?>.*?</script>', '', text, flags=re.DOTALL)
    text = re.sub(r'<style.*?>.*?</style>', '', text, flags=re.DOTALL)
    # 替换常见标签
    text = text.replace('<p>', '\n').replace('</p>', '\n').replace('<br/>', '\n').replace('<br>', '\n')
    # 移除所有 HTML 标签
    text = re.sub(r'<.*?>', '', text, flags=re.DOTALL)
    # 处理 HTML 实体
    text = text.replace('&nbsp;', ' ').replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    # 合并多余空行
    text = re.sub(r'\n\s*\n+', '\n\n', text)
    
    with open(f"source/hezhiyan_outsea/{filename}.md", "w", encoding='utf-8') as f:
        f.write(text.strip())
    print(f"Saved {filename}.md")

for f in ["新手出海全流程复盘", "认知转变与排学"]:
    if os.path.exists(f"source/hezhiyan_outsea/{f}.html"):
        clean_html(f)
