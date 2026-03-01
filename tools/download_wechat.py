import requests
import re
import os

def download_wechat_article(url, filename):
    headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.0 Language/zh_CN',
        'Referer': 'https://mp.weixin.qq.com/'
    }
    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.encoding = 'utf-8'
        if response.status_code == 200:
            # 简单清理 HTML
            content = response.text
            # 这里我后续会用 AI 提取正文，先保存 HTML
            with open(f"source/hezhiyan_outsea/{filename}.html", "w") as f:
                f.write(content)
            print(f"Successfully downloaded {filename}")
        else:
            print(f"Failed to download {filename}, status code: {response.status_code}")
    except Exception as e:
        print(f"Error downloading {filename}: {str(e)}")

# 目标 URL 列表
urls = {
    "新手出海全流程复盘": "https://mp.weixin.qq.com/s/34x7hsP_lG-iACnyvjYBfw",
    "认知转变与排学": "https://mp.weixin.qq.com/s?__biz=MzkzNzYzNzE3Mg==&mid=2247483721&idx=1&sn=e9d9896d6f64e718b0a780adc5ec7fac&chksm=c28d2512f5faac04473bae02682574b811a302b89869718b961c8d265ab1db5855446137fd7b#rd"
}

os.makedirs("source/hezhiyan_outsea", exist_ok=True)
for name, url in urls.items():
    download_wechat_article(url, name)
