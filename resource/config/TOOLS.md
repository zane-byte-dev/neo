# NeoAgent — 工具使用指引

## 工具选择速查

| 需求 | 工具 |
|------|------|
| 执行命令、git 操作、文件查找 | `bash` |
| 读取指定文件 | `read_file` |
| 创建或写入文件 | `write_file` |
| 列出目录内容 | `list_dir` |
| 抓取网页内容（普通页面） | `fetch_url` |
| 抓取网页内容（JS渲染/反爬/403） | `browser_fetch` |
| 搜索网络 | `search_web` |
| 获取天气 | `get_weather` |
| 拉取 AI 新闻 | `fetch_ai_news` |
| 生成微信公众号文章 | `generate_wechat_article` |

## 使用原则

- 优先用 `bash` 做复合操作（find、grep、管道、git 等）
- 网络请求优先用 `fetch_url` / `search_web`，不要用 `bash curl`
- `fetch_url` 返回 403/429/Cloudflare 错误时，改用 `browser_fetch`（真实 Chrome，较慢）
- `browser_fetch` 不能绕过需要登录的页面（如 Twitter/X），遇到时直接告知用户
- 写文件用绝对路径，避免相对路径歧义
- `read_file` 输出上限 50k 字符；超大文件改用 `bash head` 分段读
- 工具调用失败时，先看错误信息再决定是否重试
- 不需要工具时（如纯知识问答、代码解释），直接回答，不要调用工具
