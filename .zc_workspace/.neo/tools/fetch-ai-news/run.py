#!/usr/bin/env python3
"""
fetch-ai-news — 从 Reddit / Hacker News / RSS 聚合 AI 热点新闻
stdin: JSON { args, context }
stdout: JSON { type: 'text', content: '...' }
"""
import json
import sys
import re
import time
import urllib.request
import urllib.parse


UA = "Mozilla/5.0 (compatible; inkClaw/2.0)"
TIMEOUT = 12


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode())


def fetch_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode()


def gather_reddit(subreddits, time_range, max_per_source):
    stories = []
    for sub in subreddits:
        try:
            url = (
                f"https://www.reddit.com/r/{urllib.parse.quote(sub)}"
                f"/top.json?limit={max_per_source}&t={urllib.parse.quote(time_range)}"
            )
            data = fetch_json(url)
            for post in data.get("data", {}).get("children", []):
                p = post.get("data", {})
                if not p or p.get("stickied") or p.get("over_18"):
                    continue
                ext = p.get("url", "")
                stories.append({
                    "source": f"Reddit r/{sub}",
                    "title": p.get("title", ""),
                    "score": f"{p.get('score', 0)} 赞 / {p.get('num_comments', 0)} 评论",
                    "discussionUrl": f"https://reddit.com{p.get('permalink', '')}",
                    "externalUrl": ext if ext and "reddit.com" not in ext else None,
                })
        except Exception:
            continue
    return stories


def gather_hackernews(time_range, max_per_source):
    stories = []
    try:
        seconds_ago = {"week": 7 * 86400, "month": 30 * 86400}.get(time_range, 86400)
        since = int(time.time()) - seconds_ago
        query = urllib.parse.quote("AI LLM machine learning")
        url = (
            f"https://hn.algolia.com/api/v1/search?tags=story"
            f"&query={query}&hitsPerPage={max_per_source}"
            f"&numericFilters=created_at_i>{since},points>10"
        )
        data = fetch_json(url)
        for h in data.get("hits", []):
            if not h.get("title"):
                continue
            stories.append({
                "source": "Hacker News",
                "title": h["title"],
                "score": f"{h.get('points', 0)} 分 / {h.get('num_comments', 0)} 评论",
                "discussionUrl": f"https://news.ycombinator.com/item?id={h.get('objectID', '')}",
                "externalUrl": h.get("url"),
            })
    except Exception:
        pass
    return stories


def gather_rss(max_per_source):
    feeds = [
        ("TechCrunch AI", "https://techcrunch.com/tag/artificial-intelligence/feed/"),
        ("The Verge AI", "https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"),
    ]
    stories = []
    item_re = re.compile(r"<item[^>]*>([\s\S]*?)</item>")
    title_re = re.compile(r"<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</title>")
    link_re = re.compile(r"<link>([^<]+)</link>")
    desc_re = re.compile(r"<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</description>")

    for name, url in feeds:
        try:
            xml = fetch_text(url)
            count = 0
            for m in item_re.finditer(xml):
                if count >= max_per_source:
                    break
                body = m.group(1)
                title_m = title_re.search(body)
                link_m = link_re.search(body)
                desc_m = desc_re.search(body)
                title = (title_m.group(1) if title_m else "").strip()
                link = (link_m.group(1) if link_m else "").strip()
                snippet = (desc_m.group(1) if desc_m else "").strip()
                snippet = re.sub(r"<[^>]+>", "", snippet)
                snippet = re.sub(r"\s+", " ", snippet).strip()[:150]
                if not title or not link:
                    continue
                stories.append({
                    "source": name,
                    "title": title,
                    "score": "",
                    "discussionUrl": link,
                    "snippet": snippet or None,
                })
                count += 1
        except Exception:
            continue
    return stories


def main():
    raw = sys.stdin.read()
    data = json.loads(raw)
    args = data.get("args", {})

    time_range = str(args.get("time_range", "day"))
    enabled = [s.strip().lower() for s in str(args.get("sources", "reddit,hackernews,rss")).split(",")]
    subreddits = [s.strip() for s in str(
        args.get("subreddits", "artificial,MachineLearning,ChatGPT,LocalLLaMA,singularity")
    ).split(",") if s.strip()]
    max_per_source = min(int(args.get("max_per_source", 5)), 15)

    stories = []
    if "reddit" in enabled:
        stories.extend(gather_reddit(subreddits, time_range, max_per_source))
    if "hackernews" in enabled:
        stories.extend(gather_hackernews(time_range, max_per_source))
    if "rss" in enabled:
        stories.extend(gather_rss(max_per_source))

    if not stories:
        print(json.dumps({
            "type": "text",
            "content": "[Info] 暂时未能获取到新闻内容，网络可能受限，请稍后重试或手动提供选题。",
        }))
        return

    sections = []

    reddit_stories = [s for s in stories if s["source"].startswith("Reddit")]
    if reddit_stories:
        lines = []
        for s in reddit_stories:
            ext = f"\n   外链: {s['externalUrl']}" if s.get("externalUrl") else ""
            lines.append(f"• {s['title']}\n   热度: {s['score']} | {s['source']}\n   讨论: {s['discussionUrl']}{ext}")
        sections.append(f"## 📌 Reddit 热帖\n\n" + "\n\n".join(lines))

    hn_stories = [s for s in stories if s["source"] == "Hacker News"]
    if hn_stories:
        lines = []
        for s in hn_stories:
            ext = f"\n   外链: {s['externalUrl']}" if s.get("externalUrl") else ""
            lines.append(f"• {s['title']}\n   热度: {s['score']}\n   讨论: {s['discussionUrl']}{ext}")
        sections.append(f"## 🔶 Hacker News\n\n" + "\n\n".join(lines))

    rss_stories = [s for s in stories if not s["source"].startswith("Reddit") and s["source"] != "Hacker News"]
    if rss_stories:
        lines = []
        for s in rss_stories:
            snip = f"\n   {s['snippet']} …" if s.get("snippet") else ""
            lines.append(f"• {s['title']}{snip}\n   {s['discussionUrl']}")
        sections.append(f"## 📰 科技媒体 (RSS)\n\n" + "\n\n".join(lines))

    range_label = {"week": "过去 7 天", "month": "过去 30 天"}.get(time_range, "过去 24 小时")

    output = (
        f"# 🤖 AI 热点新闻聚合（{range_label}）\n\n"
        + "\n\n---\n\n".join(sections)
        + "\n\n---\n提示：你可以让我基于以上内容撰写一篇微信公众号文章草稿。"
    )

    print(json.dumps({"type": "text", "content": output}))


if __name__ == "__main__":
    main()
