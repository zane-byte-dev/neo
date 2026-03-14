import os
import re
import json
import time
import requests
from urllib.parse import urlparse

def fetch_wechat_article(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/04.1",
        "Referer": "https://mp.weixin.qq.com/"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"Status Code: {response.status_code}")
            return None
        
        html = response.text
        
        # 提取标题
        title = "Untitled"
        title_patterns = [
            r'var msg_title = \'(.*?)\';',
            r'<meta property="og:title" content="(.*?)"',
            r'<title>(.*?)</title>'
        ]
        for p in title_patterns:
            m = re.search(p, html)
            if m:
                title = m.group(1).strip()
                break
        
        # 提取正文内容
        # 微信文章主体通常在 js_content 中
        body_match = re.search(r'id=["\']js_content["\'][^>]*>(.*?)</div>\s*<script', html, re.DOTALL)
        if not body_match:
            body_match = re.search(r'id=["\']js_content["\'][^>]*>(.*?)</div>', html, re.DOTALL)
            
        if not body_match:
            print("Could not find article body.")
            return None
            
        content = body_match.group(1)
        
        # 1. 专门处理微信图片: data-src -> src
        # 微信懒加载图片都在 data-src 里
        img_pattern = re.compile(r'<img [^>]*data-src=["\'](.*?)["\'][^>]*>')
        
        def img_replace(match):
            src = match.group(1).strip()
            # 补齐协议头（如果有需要）
            if src.startswith('//'):
                src = 'https:' + src
            return f"\n\n![image]({src})\n\n"
            
        content = img_pattern.sub(img_replace, content)
        
        # 2. 处理图片背景样式 (微信偶尔用 background-image)
        bg_img_pattern = re.compile(r'style=["\'][^"\']*background-image: url\(&quot;(.*?)&quot;\);[^"\']*["\']')
        content = bg_img_pattern.sub(img_replace, content)
        
        # 3. 清理 HTML 脚本和复杂标签 (非常暴力的清理，但对微信这类图文比较有效)
        # 先把 <p> 标签转成换行，保留结构感
        content = content.replace('</p>', '\n')
        content = content.replace('</div>', '\n')
        content = content.replace('<br/>', '\n')
        content = content.replace('<br>', '\n')
        
        # 移除所有剩余 HTML 标签
        markdown_body = re.sub(r'<[^>]+>', '', content)
        
        # 转换转义字符
        markdown_body = markdown_body.replace('&nbsp;', ' ')
        markdown_body = markdown_body.replace('&amp;', '&')
        markdown_body = markdown_body.replace('&lt;', '<')
        markdown_body = markdown_body.replace('&gt;', '>')
        markdown_body = markdown_body.replace('&quot;', '"')
        markdown_body = markdown_body.replace('&#39;', "'")
        
        # 整理空行
        markdown_body = re.sub(r'\n\s*\n', '\n\n', markdown_body).strip()
        
        # 构建最终 MD (保持原文 URL)
        final_md = f"# {title}\n\n{markdown_body}"
        return final_md
        
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def main():
    json_path = "/Users/zhengchao/mox/inkClaw/pending_links.json"
    if not os.path.exists(json_path):
        print("pending_links.json 不存在。")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        tasks = json.load(f)

    # 我们按顺序抓取所有
    test_tasks = [t for t in tasks if "mp.weixin.qq.com" in t['url']]
    
    count = 0
    success_count = 0
    for task in test_tasks:
        file_path = task['file']
        url = task['url']
        
        if not os.path.exists(file_path): continue
            
        with open(file_path, 'r', encoding='utf-8') as f:
            content_in_file = f.read()
        
        if "(Content to be fetched)" not in content_in_file:
            continue
            
        count += 1
        print(f">>> 抓取中 ({count}): {os.path.basename(file_path)}...")
            
        md_content = fetch_wechat_article(url)
        if md_content:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            new_lines = []
            for line in lines:
                if "(Content to be fetched)" in line:
                    new_lines.append(md_content + "\n")
                else:
                    new_lines.append(line)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print("    [完成]")
            success_count += 1
            time.sleep(1.0) # 进一步优化抓取效率
        else:
            print("    [失败]")
            
    if count == 0:
        print("没有检测到需要抓取的内容，请确保占位符 '(Content to be fetched)' 存在。")
    else:
        print(f"任务结束：共尝试 {count} 篇，成功 {success_count} 篇。")

if __name__ == "__main__":
    main()
